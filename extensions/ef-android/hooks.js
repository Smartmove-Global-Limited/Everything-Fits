'use strict';
// Android build hooks: everything that used to be manual steps around Cocos' Build button.
//   before Build  delete build/android/data (Cocos keeps files of earlier builds: old images shipped)
//   after Build   tools/android-prepare.sh (Gradle for JDK 21, AppsFlyer key, no Cocos logo, app name),
//                 then Gradle packs the app chosen in the Build panel ("EF Android" section):
//                   store  release AAB + APK, signed with native/engine/android/keystore.properties
//                   test   optimised APK installed next to the store app (package .cocos)
//                 and prints version, signing key and output files in the build log.
// Make is not needed (and fails: the Cocos 3.8.2 Gradle template wants JDK 17).
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PKG = 'ef-android';
const STUDIO_JDK = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const MODULE = 'EverythingFits-Cocos';

exports.throwError = true;
exports.title = 'EF Android';

const projectRoot = () => Editor.Project.path;
function buildDir(options) {
  const base = String(options.buildPath || 'project://build').replace(/^project:\/\//, projectRoot() + '/');
  return path.join(base, options.outputName || 'android');
}
const modeOf = options => (options.packages && options.packages[PKG] && options.packages[PKG].output) || 'store';

function readProps(file) {
  const out = {};
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function run(cmd, args, cwd, env) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let tail = '';
    const onData = d => {
      const text = String(d);
      tail = (tail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        // Gradle is chatty: keep task progress and errors, drop javac notes and Kotlin metadata noise
        if (!line.trim() || /^Note:|warning:|incompatible version of Kotlin/.test(line)) continue;
        console.log(`[${PKG}] ${line}`);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', fail);
    p.on('close', code => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} failed (${code})\n${tail}`))));
  });
}

const STORE_PACKAGE = 'everything.fits.packing.puzzle.organize';

exports.onBeforeBuild = async function (options) {
  if (options.platform !== 'android') return;
  if (modeOf(options) === 'store') {
    // a store build with test settings would be rejected by Google Play or run badly on phones
    const a = (options.packages && options.packages.android) || {};
    if (a.packageName !== STORE_PACKAGE) throw new Error(`Game Package Name must be ${STORE_PACKAGE} (now ${a.packageName})`);
    if (options.debug) throw new Error('Store build: turn Debug off in the Build panel');
    const abis = a.appABIs || [];
    if (!abis.includes('arm64-v8a') || !abis.includes('armeabi-v7a')) console.warn(`[${PKG}] APP ABI should be armeabi-v7a + arm64-v8a (now ${abis.join(', ')})`);
    if ((a.apiLevel || 0) < 35) console.warn(`[${PKG}] Target API Level ${a.apiLevel}: Google Play needs 35 or higher`);
  }
  const data = path.join(buildDir(options), 'data');
  fs.rmSync(data, { recursive: true, force: true });
  console.log(`[${PKG}] cleaned ${data}`);
};

exports.onAfterBuild = async function (options) {
  if (options.platform !== 'android') return;
  const root = projectRoot();
  const androidDir = path.join(root, 'native/engine/android');
  execFileSync('sh', [path.join(root, 'tools/android-prepare.sh')], { cwd: root });
  console.log(`[${PKG}] Android project prepared`);

  const mode = modeOf(options);
  if (mode === 'none') { console.log(`[${PKG}] packing skipped: open build/android/proj in Android Studio`); return; }

  const ver = readProps(path.join(androidDir, 'version.properties')) || {};
  console.log(`[${PKG}] version code ${ver.versionCode} / name ${ver.versionName}  (native/engine/android/version.properties)`);

  if (mode === 'store') {
    const ks = readProps(path.join(androidDir, 'keystore.properties'));
    if (!ks) throw new Error('native/engine/android/keystore.properties is missing: the store build cannot be signed');
    const jks = path.join(androidDir, ks.storeFile || '');
    if (!ks.storeFile || !fs.existsSync(jks)) throw new Error(`keystore file not found: ${jks}`);
    console.log(`[${PKG}] signing with ${ks.storeFile}, alias ${ks.keyAlias}  (native/engine/android/keystore.properties)`);
  }

  const javaHome = process.env.EF_JAVA_HOME || (fs.existsSync(STUDIO_JDK) ? STUDIO_JDK : process.env.JAVA_HOME);
  const tasks = mode === 'store' ? [`:${MODULE}:bundleRelease`, `:${MODULE}:assembleRelease`] : [`:${MODULE}:assemblePreview`];
  const proj = path.join(buildDir(options), 'proj');
  console.log(`[${PKG}] Gradle ${tasks.join(' ')} (first time: 10–20 min)…`);
  await run('./gradlew', [...tasks, '--console=plain', '-q'], proj, { JAVA_HOME: javaHome });

  const out = path.join(proj, 'build', MODULE, 'outputs');
  const files = mode === 'store'
    ? [path.join(out, `bundle/release/${MODULE}-release.aab`), path.join(out, `apk/release/${MODULE}-release.apk`)]
    : [path.join(out, `apk/preview/${MODULE}-preview.apk`)];
  for (const f of files) console.log(`[${PKG}] ${fs.existsSync(f) ? 'OK' : 'MISSING'} ${f}`);

  if (mode === 'store' && fs.existsSync(files[0])) {
    // the key the AAB is really signed with, to check against Google Play before uploading
    try {
      const cert = execFileSync(path.join(javaHome, 'bin/keytool'), ['-printcert', '-jarfile', files[0]], { encoding: 'utf8' });
      const owner = (cert.match(/Owner: (.*)/) || [])[1];
      const sha = (cert.match(/SHA256: ([0-9A-F:]+)/) || [])[1];
      console.log(`[${PKG}] AAB signed by: ${owner}`);
      console.log(`[${PKG}] SHA256: ${sha}`);
    } catch (e) { console.warn(`[${PKG}] could not read the AAB signature: ${e.message}`); }
    try { execFileSync('open', ['-R', files[0]]); } catch { /* Finder not available */ }
  }
};

exports.onBeforeMake = async function () {
  throw new Error('EF Android: Make is not needed. Build already packed the app (see "Đóng gói sau Build" in the Build panel).');
};

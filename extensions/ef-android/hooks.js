'use strict';
// Android build hooks: everything that used to be manual steps around Cocos' Build button.
//   before Build  check the Build panel settings, delete build/android/data (Cocos keeps files of
//                 earlier builds: old images shipped). Version and signing were saved by the
//                 EF Android panel (main.js) to native/engine/android/version.properties and
//                 keystore.properties, read by Gradle and Android Studio.
//   after Build   tools/android-prepare.sh (Gradle for JDK 21, AppsFlyer key, no Cocos logo, app name),
//                 then Gradle packs what the Build panel asks:
//                   device  optimised APK with the Android debug key, installed over the app put on
//                           the phone by Android Studio (same package), via adb
//                   store   release AAB + APK signed with the key store of the panel
//                   test    optimised APK installed next to the store app (package .cocos)
//                 and prints version, signing key and output files in the build log.
// Make is not needed (and fails: the Cocos 3.8.2 Gradle template wants JDK 17).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PKG = 'ef-android';
const STUDIO_JDK = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const MODULE = 'EverythingFits-Cocos';
const STORE_PACKAGE = 'everything.fits.packing.puzzle.organize';

exports.throwError = true;
exports.title = 'EF Android';

const projectRoot = () => Editor.Project.path;
const androidDir = () => path.join(projectRoot(), 'native/engine/android');
function buildDir(options) {
  const base = String(options.buildPath || 'project://build').replace(/^project:\/\//, projectRoot() + '/');
  return path.join(base, options.outputName || 'android');
}
const panel = options => (options.packages && options.packages[PKG]) || {};
const modeOf = options => panel(options).output || 'device';
const javaHome = () => process.env.EF_JAVA_HOME || (fs.existsSync(STUDIO_JDK) ? STUDIO_JDK : process.env.JAVA_HOME);
const adbPath = () => {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
  return path.join(sdk, 'platform-tools/adb');
};

function readProps(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/\\\\/g, '\\');
  }
  return out;
}
const propValue = v => String(v).replace(/\\/g, '\\\\');

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
    p.on('close', code => (code === 0 ? ok(tail) : fail(new Error(`${cmd} ${args.join(' ')} failed (${code})\n${tail}`))));
  });
}

/** SHA-256 of a signed AAB / APK, or of the key in a key store */
function certSha(args) {
  const out = execFileSync(path.join(javaHome(), 'bin/keytool'), args, { encoding: 'utf8' });
  return { owner: (out.match(/Owner: (.*)/) || [])[1], sha: (out.match(/SHA256: ([0-9A-F:]+)/) || [])[1] };
}

// progress / result for the EF Android panel (main.js buildStatus)
function status(options, s) {
  const file = path.join(projectRoot(), 'temp/ef-android/status.json');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first build */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...old, mode: modeOf(options), ...s, at: Date.now() }));
}

exports.onBeforeBuild = async function (options) {
  if (options.platform !== 'android') return;
  const mode = modeOf(options);
  if (mode === 'store' || mode === 'device') {
    // a store build with test settings would be rejected by Google Play or run badly on phones
    const a = (options.packages && options.packages.android) || {};
    if (a.packageName !== STORE_PACKAGE) throw new Error(`Game Package Name must be ${STORE_PACKAGE} (now ${a.packageName})`);
    if (mode === 'store' && options.debug) throw new Error('Store build: turn Debug off in the Build panel');
    const abis = a.appABIs || [];
    if (mode === 'store' && (!abis.includes('arm64-v8a') || !abis.includes('armeabi-v7a'))) console.warn(`[${PKG}] APP ABI should be armeabi-v7a + arm64-v8a (now ${abis.join(', ')})`);
    if ((a.apiLevel || 0) < 35) console.warn(`[${PKG}] Target API Level ${a.apiLevel}: Google Play needs 35 or higher`);
  }
  status(options, { state: 'building', step: 'Cocos build…', error: null, files: null, sha: null, owner: null, installed: null });
  const data = path.join(buildDir(options), 'data');
  fs.rmSync(data, { recursive: true, force: true });
  console.log(`[${PKG}] cleaned ${data}`);
};

exports.onAfterBuild = async function (options) {
  if (options.platform !== 'android') return;
  try { await afterBuild(options); }
  catch (e) { status(options, { state: 'failed', error: String(e && e.message || e) }); throw e; }
};

exports.onError = async function (options) {
  if (options.platform === 'android') status(options, { state: 'failed', error: 'Cocos build failed: see the Build panel log' });
};

async function afterBuild(options) {
  const root = projectRoot(), dir = androidDir();
  execFileSync('sh', [path.join(root, 'tools/android-prepare.sh')], { cwd: root });
  console.log(`[${PKG}] Android project prepared`);

  const mode = modeOf(options);
  if (mode === 'none') { status(options, { state: 'done', step: 'Cocos build done' }); console.log(`[${PKG}] packing skipped: open build/android/proj in Android Studio`); return; }

  const ver = readProps(path.join(dir, 'version.properties')) || {};
  console.log(`[${PKG}] version code ${ver.versionCode} / name ${ver.versionName}`);
  let keySha = null;
  if (mode === 'store') {
    const ks = readProps(path.join(dir, 'keystore.properties'));
    if (!ks || !ks.storePassword) throw new Error('EF Android: no key store password: fill the EF Android panel (menu Extension)');
    const jks = path.isAbsolute(ks.storeFile || '') ? ks.storeFile : path.join(dir, ks.storeFile || '');
    if (!fs.existsSync(jks)) throw new Error(`key store not found: ${jks}`);
    try { keySha = certSha(['-list', '-v', '-keystore', jks, '-alias', ks.keyAlias, '-storepass', ks.storePassword]).sha; }
    catch { throw new Error('EF Android: wrong Key store password or Key alias'); }
    console.log(`[${PKG}] signing with ${jks}, alias ${ks.keyAlias}`);
  } else if (mode === 'device') {
    console.log(`[${PKG}] signing with the Android debug key (~/.android/debug.keystore), like Run in Android Studio`);
  }

  const tasks = { store: ['bundleRelease', 'assembleRelease'], device: ['assembleDevice'], test: ['assemblePreview'] }[mode].map(t => `:${MODULE}:${t}`);
  const proj = path.join(buildDir(options), 'proj');
  console.log(`[${PKG}] Gradle ${tasks.join(' ')} (first time: 10–20 min)…`);
  status(options, { step: 'Gradle: đóng gói APK / AAB (lần đầu 10–20 phút)…' });
  await run('./gradlew', [...tasks, '--console=plain', '-q'], proj, { JAVA_HOME: javaHome() });

  const out = path.join(proj, 'build', MODULE, 'outputs');
  const files = {
    store: [path.join(out, `bundle/release/${MODULE}-release.aab`), path.join(out, `apk/release/${MODULE}-release.apk`)],
    device: [path.join(out, `apk/device/${MODULE}-device.apk`)],
    test: [path.join(out, `apk/preview/${MODULE}-preview.apk`)],
  }[mode];
  for (const f of files) console.log(`[${PKG}] ${fs.existsSync(f) ? 'OK' : 'MISSING'} ${f}`);

  if (mode === 'store' && fs.existsSync(files[0])) {
    // the key the AAB is really signed with, to check against Google Play before uploading
    const c = certSha(['-printcert', '-jarfile', files[0]]);
    console.log(`[${PKG}] AAB signed by: ${c.owner}`);
    console.log(`[${PKG}] SHA256: ${c.sha}`);
    if (keySha && c.sha !== keySha) throw new Error('EF Android: the AAB is NOT signed with the key store of the panel');
    status(options, { owner: c.owner, sha: c.sha });
    try { execFileSync('open', ['-R', files[0]]); } catch { /* Finder not available */ }
  }

  if ((mode === 'device' || mode === 'test') && fs.existsSync(files[0])) {
    const adb = adbPath();
    const devices = fs.existsSync(adb) ? execFileSync(adb, ['devices'], { encoding: 'utf8' }).split('\n').slice(1).filter(l => /\tdevice$/.test(l)) : [];
    if (!devices.length) {
      console.warn(`[${PKG}] no phone connected (USB debugging): install ${files[0]} by hand`);
      status(options, { state: 'done', files, installed: 'Không thấy máy nào cắm USB (bật gỡ lỗi USB): tự cài file APK' });
      return;
    }
    console.log(`[${PKG}] installing on ${devices[0].split('\t')[0]} (confirm on the phone if it asks)…`);
    status(options, { step: 'Đang cài lên máy… bấm Cài đặt trên điện thoại nếu nó hỏi' });
    try {
      const r = execFileSync(adb, ['install', '-r', '-t', files[0]], { encoding: 'utf8' });
      console.log(`[${PKG}] ${r.trim().split('\n').pop()}`);
      status(options, { installed: 'Đã cài lên máy ' + devices[0].split('\t')[0] });
    } catch (e) {
      const why = String(e.stdout || e.message);
      if (/UPDATE_INCOMPATIBLE/.test(why)) throw new Error('EF Android: the app on the phone is signed with another key: uninstall it first');
      if (/USER_RESTRICTED/.test(why)) throw new Error('EF Android: the install was not confirmed on the phone: build again and tap Install');
      throw new Error(`EF Android: install failed\n${why}`);
    }
  }
  status(options, { state: 'done', step: 'Xong', files: files.filter(f => fs.existsSync(f)) });
}

exports.onBeforeMake = async function () {
  throw new Error('EF Android: Make is not needed. Build already packed the app (see "Đóng gói sau Build" in the Build panel).');
};

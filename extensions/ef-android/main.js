'use strict';
// EF Android panel backend (main process).
//   loadSettings  version (native/engine/android/version.properties, in git) and signing
//                 (native/engine/android/keystore.properties, NOT in git: it holds the passwords)
//   startBuild    saves the fields, checks the key store password, then queues the Cocos Android
//                 build (tools/android-build.json) with the packing mode for hooks.js:
//                   device  debug key, installed over the app put on the phone by Android Studio
//                   store   release AAB + APK signed with the key store, for Google Play
//   buildStatus   progress / result written by hooks.js to temp/ef-android/status.json
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STUDIO_JDK = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const DEFAULT_KEYSTORE = '/Users/buiduy/Documents/game/cater/paint_the_room.jks';
const DEFAULT_ALIAS = 'game';

const root = () => Editor.Project.path;
const androidDir = () => path.join(root(), 'native/engine/android');
const statusFile = () => path.join(root(), 'temp/ef-android/status.json');
const javaHome = () => process.env.EF_JAVA_HOME || (fs.existsSync(STUDIO_JDK) ? STUDIO_JDK : process.env.JAVA_HOME);

function readProps(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/\\\\/g, '\\');
  }
  return out;
}
const propValue = v => String(v).replace(/\\/g, '\\\\');

function writeStatus(s) {
  fs.mkdirSync(path.dirname(statusFile()), { recursive: true });
  fs.writeFileSync(statusFile(), JSON.stringify({ ...s, at: Date.now() }));
}
function readStatus() {
  try { return JSON.parse(fs.readFileSync(statusFile(), 'utf8')); } catch { return { state: 'idle' }; }
}

exports.load = function () {};
exports.unload = function () {};

exports.methods = {
  // the full panel name: the short 'ef-android' stopped opening it (the menu did nothing)
  openPanel() { Editor.Panel.open('ef-android.default'); },

  loadSettings() {
    const ver = readProps(path.join(androidDir(), 'version.properties'));
    const ks = readProps(path.join(androidDir(), 'keystore.properties'));
    let storeFile = ks.storeFile || DEFAULT_KEYSTORE;
    if (!path.isAbsolute(storeFile)) storeFile = path.join(androidDir(), storeFile);
    return {
      versionCode: Number(ver.versionCode) || 6,
      versionName: ver.versionName || '0.0.2',
      keystorePath: storeFile,
      keystorePassword: ks.storePassword || '',
      keyAlias: ks.keyAlias || DEFAULT_ALIAS,
      keyPassword: ks.keyPassword || '',
    };
  },

  async startBuild(mode, f) {
    if (!['device', 'store'].includes(mode)) return { ok: false, error: 'unknown build' };
    const st = readStatus();
    if (st.state === 'building' && Date.now() - st.at < 45 * 60e3) return { ok: false, error: 'Đang có một bản build chạy, đợi nó xong đã' };
    const code = parseInt(f.versionCode, 10), name = String(f.versionName || '').trim();
    if (!(code > 0) || !name) return { ok: false, error: 'Điền Version code (số nguyên) và Version name' };
    fs.writeFileSync(path.join(androidDir(), 'version.properties'),
      '# Version of the Android app (EF Android panel). Raise BOTH before every upload / install over.\n' +
      `versionCode=${code}\nversionName=${name}\n`);

    if (mode === 'store') {
      if (!f.keystorePath || !fs.existsSync(f.keystorePath)) return { ok: false, error: `Không thấy file khoá: ${f.keystorePath || '(trống)'}` };
      if (!f.keystorePassword || !f.keyAlias || !f.keyPassword) return { ok: false, error: 'Điền đủ Key store password, Key alias, Key password' };
      // wrong password / alias: say it now, not after a 10-minute build
      try {
        execFileSync(path.join(javaHome(), 'bin/keytool'), ['-list', '-keystore', f.keystorePath, '-alias', f.keyAlias, '-storepass', f.keystorePassword], { stdio: 'pipe' });
      } catch { return { ok: false, error: 'Sai Key store password hoặc Key alias' }; }
      fs.writeFileSync(path.join(androidDir(), 'keystore.properties'),
        '# Release signing (EF Android panel). NOT in git: it holds the passwords.\n' +
        `storeFile=${propValue(f.keystorePath)}\nstorePassword=${propValue(f.keystorePassword)}\n` +
        `keyAlias=${propValue(f.keyAlias)}\nkeyPassword=${propValue(f.keyPassword)}\n`);
    }

    const cfg = JSON.parse(fs.readFileSync(path.join(root(), 'tools/android-build.json'), 'utf8'));
    cfg.packages['ef-android'] = { output: mode };
    // a build for one phone only needs the 64-bit engine: half the compile time
    if (mode === 'device') cfg.packages.android.appABIs = ['arm64-v8a'];
    writeStatus({ state: 'building', mode, step: 'Cocos build…', version: `${code} (${name})` });
    // not awaited: the panel follows the build through buildStatus
    Editor.Message.request('builder', 'add-task', cfg).catch(e => writeStatus({ state: 'failed', mode, error: String(e && e.message || e) }));
    return { ok: true };
  },

  buildStatus() { return readStatus(); },
};

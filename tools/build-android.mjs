// Build the Android app from the command line, exactly like the Build button in Cocos Creator
// (Cocos Creator must be open with EF Bridge enabled). The packing itself is done by the
// extension EF Android (extensions/ef-android/hooks.js) right after the Cocos build.
//   node tools/build-android.mjs device  → debug key, installed over the app on the phone (USB)
//   node tools/build-android.mjs store   → Google Play: release AAB + APK, signed with keystore.properties
//   node tools/build-android.mjs test    → optimised test APK next to the store app (package .cocos)
// Easier: menu Extension → EF Android (panel with the version, the key store and two buttons).
// Build settings: tools/android-build.json. Version: native/engine/android/version.properties.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] || 'store';
if (!['device', 'store', 'test'].includes(mode)) { console.error('usage: node tools/build-android.mjs device|store|test'); process.exit(1); }
// a store build never ships the testers' fake purchases (Purchases.ts TEMP_FAKE_IAP)
if (mode === 'store' && /TEMP_FAKE_IAP\s*=\s*true/.test(readFileSync(new URL('../assets/scripts/services/Purchases.ts', import.meta.url), 'utf8'))) {
  console.error('Purchases.ts: TEMP_FAKE_IAP is true (fake purchases). Set it to false before a store build.'); process.exit(1);
}
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const msg = (module, message, args = []) => fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module, message, args }) }).then(r => r.json());
const tasks = async () => JSON.stringify((await msg('builder', 'query-tasks-info')).result);
const count = (s, re) => (s.match(re) || []).length;

const cfg = JSON.parse(readFileSync(`${ROOT}tools/android-build.json`, 'utf8'));
cfg.packages['ef-android'] = { output: mode };
if (mode === 'device') cfg.packages.android.appABIs = ['arm64-v8a'];   // one phone: 64-bit only
const before = await tasks();
await msg('builder', 'add-task', [cfg]);
console.log(`building (${mode})… the log is in Cocos Creator: Build panel → the task's log`);
for (let i = 0; ; i++) {
  const now = await tasks();
  if (count(now, /build success/g) > count(before, /build success/g)) break;
  if (count(now, /build failed|"state":"failure"/gi) > count(before, /build failed|"state":"failure"/gi)) { console.error('build failed: see the Build panel log'); process.exit(1); }
  if (i > 900) { console.error('build did not finish in 30 minutes'); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
}
const out = `${ROOT}build/android/proj/build/EverythingFits-Cocos/outputs`;
const ver = Object.fromEntries(readFileSync(`${ROOT}native/engine/android/version.properties`, 'utf8').split('\n')
  .map(l => l.match(/^\s*(\w+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const name = `EverythingFits-v${ver.versionName}-code${ver.versionCode}`;   // app/build.gradle base.archivesName
console.log({
  store: `done:\n  ${out}/bundle/release/${name}-release.aab   (upload to Google Play)\n  ${out}/apk/release/${name}-release.apk`,
  device: `done (installed if a phone is connected):\n  ${out}/apk/device/${name}-device.apk`,
  test: `done:\n  ${out}/apk/preview/${name}-preview.apk`,
}[mode]);

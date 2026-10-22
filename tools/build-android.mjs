// Build the Android app from the command line (Cocos Creator must be open with EF Bridge enabled).
//   node tools/build-android.mjs store   → Google Play: release AAB + APK, signed with keystore.properties
//   node tools/build-android.mjs test    → optimised test APK next to the store app (package .cocos)
// Steps: Cocos build with tools/android-build.json (clean data folder, so no stale assets ship),
// tools/android-prepare.sh, then Gradle. Version code / name: native/engine/android/app/build.gradle.
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] || 'store';
if (!['store', 'test'].includes(mode)) { console.error('usage: node tools/build-android.mjs store|test'); process.exit(1); }
const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Gradle 8.7 runs on JDK ≤ 21: the JDK bundled with Android Studio, not whatever JAVA_HOME points to
const STUDIO_JDK = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const JAVA_HOME = process.env.EF_JAVA_HOME || (existsSync(STUDIO_JDK) ? STUDIO_JDK : process.env.JAVA_HOME);
const msg = (module, message, args = []) => fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module, message, args }) }).then(r => r.json());
const successes = async () => (JSON.stringify((await msg('builder', 'query-tasks-info')).result).match(/build success/g) || []).length;

if (mode === 'store' && !existsSync(`${ROOT}native/engine/android/keystore.properties`))
  console.warn('!! no native/engine/android/keystore.properties: the release is signed with the Build panel keystore');

console.log('Cocos build…');
rmSync(`${ROOT}build/android/data`, { recursive: true, force: true });
const before = await successes();
await msg('builder', 'add-task', [JSON.parse(readFileSync(`${ROOT}tools/android-build.json`, 'utf8'))]);
for (let i = 0; (await successes()) <= before; i++) {
  if (i > 600) { console.error('Cocos build did not finish in 20 minutes'); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
}
execSync('sh tools/android-prepare.sh', { cwd: ROOT, stdio: 'inherit' });

const tasks = mode === 'store' ? ':EverythingFits-Cocos:bundleRelease :EverythingFits-Cocos:assembleRelease' : ':EverythingFits-Cocos:assemblePreview';
console.log(`Gradle ${tasks}…`);
execSync(`./gradlew ${tasks} --console=plain -q`, { cwd: `${ROOT}build/android/proj`, stdio: 'inherit', env: { ...process.env, JAVA_HOME } });
const out = `${ROOT}build/android/proj/build/EverythingFits-Cocos/outputs`;
console.log(mode === 'store'
  ? `done:\n  ${out}/bundle/release/EverythingFits-Cocos-release.aab   (upload to Google Play)\n  ${out}/apk/release/EverythingFits-Cocos-release.apk`
  : `done:\n  ${out}/apk/preview/EverythingFits-Cocos-preview.apk`);

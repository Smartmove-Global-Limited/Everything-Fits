// Calls into the native SDK glue (Android: com.cocos.game.SdkBridge, iOS: SdkBridge Objective-C
// class) through native.reflection. On the web / in the editor preview nothing is sent.
import { sys, native } from 'cc';
import { NATIVE } from 'cc/env';

const ANDROID_CLASS = 'com/cocos/game/SdkBridge';

function call(method: string, ...args: string[]) {
  if (!NATIVE) return;
  try {
    if (sys.os === sys.OS.ANDROID) {
      const sig = '(' + 'Ljava/lang/String;'.repeat(args.length) + ')V';
      (native.reflection.callStaticMethod as (...a: unknown[]) => unknown)(ANDROID_CLASS, method, sig, ...args);
    } else if (sys.os === sys.OS.IOS) {
      const sel = args.length ? method + ':' + 'with:'.repeat(args.length - 1) : method;
      (native.reflection.callStaticMethod as (...a: unknown[]) => unknown)('SdkBridge', sel, ...args);
    }
  } catch (e) { console.warn('[SdkBridge]', method, e); }
}

export const NativeBridge = {
  get enabled() { return NATIVE && (sys.os === sys.OS.ANDROID || sys.os === sys.OS.IOS); },
  /** Remove the native launch cover once the game has drawn its first frame (Android) */
  hideLaunchCover() { if (sys.os === sys.OS.ANDROID) call('hideLaunchCover'); },
  /** Same event to Firebase Analytics and AppsFlyer (params as JSON: numbers stay numbers) */
  logEvent(name: string, params: Record<string, string | number>) { call('logEvent', name, JSON.stringify(params)); },
};

// Calls into the native SDK glue (Android: com.cocos.game.SdkBridge, iOS: SdkBridge Objective-C
// class) through native.reflection. On the web / in the editor preview nothing is sent.
// Native → game messages (ads, billing, remote config) arrive as JSON on a channel through
// native.jsbBridgeWrapper; on() subscribes to one.
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

const handlers = new Map<string, ((msg: any) => void)[]>();
function listen(channel: string) {
  native.jsbBridgeWrapper.addNativeEventListener(channel, (text: string) => {
    let msg: any = null;
    try { msg = JSON.parse(text); } catch { return; }
    for (const fn of handlers.get(channel) || []) fn(msg);
  });
}

export const NativeBridge = {
  get enabled() { return NATIVE && (sys.os === sys.OS.ANDROID || sys.os === sys.OS.IOS); },
  /** Remove the native launch cover once the game has drawn its first frame (Android) */
  hideLaunchCover() { if (sys.os === sys.OS.ANDROID) call('hideLaunchCover'); },
  /** Same event to Firebase Analytics and AppsFlyer (params as JSON: numbers stay numbers) */
  logEvent(name: string, params: Record<string, string | number>) { call('logEvent', name, JSON.stringify(params)); },
  /** Android only for now: ads / billing / remote config are not wired on iOS yet */
  get android() { return NATIVE && sys.os === sys.OS.ANDROID; },
  /** Call a SdkBridge static method (String arguments only) */
  call,
  /** Messages of a native channel ("ads", "billing", "rc"), parsed from JSON */
  on(channel: string, fn: (msg: any) => void) {
    if (!NATIVE) return;
    let list = handlers.get(channel);
    if (!list) { handlers.set(channel, (list = [])); listen(channel); }
    list.push(fn);
  },
};

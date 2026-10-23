package com.cocos.game;

import android.util.Log;

import com.cocos.lib.CocosHelper;
import com.cocos.lib.JsbBridgeWrapper;

import org.json.JSONObject;

/**
 * Native → TypeScript messages. Every SDK callback (ads, billing, remote config) ends up here and is
 * delivered on the game thread through JsbBridgeWrapper; TypeScript listens with
 * native.jsbBridgeWrapper.addNativeEventListener (assets/scripts/services/NativeBridge.ts).
 */
final class ScriptEvents {
    private static final String TAG = "ScriptEvents";

    private ScriptEvents() {}

    static void send(final String channel, final JSONObject payload) {
        final String text = payload.toString();
        CocosHelper.runOnGameThread(() -> {
            try {
                JsbBridgeWrapper.getInstance().dispatchEventToScript(channel, text);
            } catch (Throwable t) {
                Log.w(TAG, "dispatch " + channel + " failed", t);
            }
        });
    }

    /** Small helper: {"type": type} plus key / value pairs */
    static JSONObject of(String type, Object... kv) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (Exception ignored) {}
        return o;
    }
}

package com.cocos.game;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import com.appsflyer.AppsFlyerLib;
import com.google.firebase.analytics.FirebaseAnalytics;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Native side of the game's analytics (TypeScript: assets/scripts/services/NativeBridge.ts).
 * Every event goes to Firebase Analytics and AppsFlyer with the same name and parameters, like
 * the web game (src/game/events.js). Facebook App Events log installs / opens by themselves
 * (AutoLogAppEventsEnabled in the manifest).
 * The AppsFlyer Dev Key is the string resource af_dev_key (from appsflyer.properties, outside git);
 * without a key the app still runs, it just sends nothing to AppsFlyer.
 */
public final class SdkBridge {
    private static final String TAG = "SdkBridge";
    private static FirebaseAnalytics firebase;
    private static boolean appsFlyerOn;

    private SdkBridge() {}

    /** Called once from AppActivity.onCreate */
    public static void init(Activity activity) {
        firebase = FirebaseAnalytics.getInstance(activity);
        int id = activity.getResources().getIdentifier("af_dev_key", "string", activity.getPackageName());
        String key = id != 0 ? activity.getString(id) : "";
        if (key == null || key.isEmpty()) { Log.w(TAG, "AppsFlyer: no Dev Key, not sending"); return; }
        AppsFlyerLib af = AppsFlyerLib.getInstance();
        af.init(key, null, activity.getApplicationContext());
        af.start(activity.getApplicationContext());
        appsFlyerOn = true;
    }

    /** From TypeScript: native.reflection.callStaticMethod('com/cocos/game/SdkBridge', 'logEvent', ...) */
    public static void logEvent(String name, String paramsJson) {
        try {
            JSONObject json = new JSONObject(paramsJson == null ? "{}" : paramsJson);
            Bundle bundle = new Bundle();
            Map<String, Object> values = new HashMap<>();
            for (Iterator<String> it = json.keys(); it.hasNext(); ) {
                String k = it.next();
                Object v = json.get(k);
                if (v instanceof Integer || v instanceof Long) bundle.putLong(k, ((Number) v).longValue());
                else if (v instanceof Number) bundle.putDouble(k, ((Number) v).doubleValue());
                else bundle.putString(k, String.valueOf(v));
                values.put(k, v);
            }
            if (firebase != null) firebase.logEvent(name, bundle);
            if (appsFlyerOn) AppsFlyerLib.getInstance().logEvent(com.cocos.lib.GlobalObject.getActivity(), name, values);
        } catch (Exception e) {
            Log.w(TAG, "logEvent " + name + " failed", e);
        }
    }
}

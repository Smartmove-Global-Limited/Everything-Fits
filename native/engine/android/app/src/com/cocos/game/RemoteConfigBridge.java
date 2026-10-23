package com.cocos.game;

import android.util.Log;

import com.google.firebase.remoteconfig.FirebaseRemoteConfig;
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings;
import com.google.firebase.remoteconfig.FirebaseRemoteConfigValue;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;

/**
 * Firebase Remote Config (TypeScript: assets/scripts/services/RemoteConfig.ts). TypeScript keeps the
 * defaults; this class fetches the values set in the Firebase console and sends them as strings.
 * Event to TypeScript, channel "rc": values{values: {key: string}}
 */
final class RemoteConfigBridge {
    private static final String TAG = "RemoteConfigBridge";
    private static final long FETCH_INTERVAL_SEC = 3600;

    private RemoteConfigBridge() {}

    /** From TypeScript: the keys it knows, as a JSON array */
    static void fetch(final String keysJson) {
        try {
            final FirebaseRemoteConfig rc = FirebaseRemoteConfig.getInstance();
            rc.setConfigSettingsAsync(new FirebaseRemoteConfigSettings.Builder().setMinimumFetchIntervalInSeconds(FETCH_INTERVAL_SEC).build());
            rc.fetchAndActivate().addOnCompleteListener(task -> {
                try {
                    JSONArray keys = new JSONArray(keysJson);
                    Map<String, FirebaseRemoteConfigValue> all = rc.getAll();
                    JSONObject values = new JSONObject();
                    for (int i = 0; i < keys.length(); i++) {
                        String k = keys.getString(i);
                        FirebaseRemoteConfigValue v = all.get(k);
                        // only values set in the console: the TypeScript defaults stay otherwise
                        if (v != null && v.getSource() == FirebaseRemoteConfig.VALUE_SOURCE_REMOTE) values.put(k, v.asString());
                    }
                    ScriptEvents.send("rc", ScriptEvents.of("values", "values", values));
                } catch (Exception e) { Log.w(TAG, "read failed", e); }
            });
        } catch (Exception e) { Log.w(TAG, "fetch failed", e); }
    }
}

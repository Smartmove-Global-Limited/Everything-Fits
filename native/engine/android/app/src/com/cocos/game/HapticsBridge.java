package com.cocos.game;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Light haptics (TypeScript: Sound.haptic): a short, clearly felt buzz of the vibration motor
 * (the phone's predefined "click" effects were too faint to feel on some phones).
 *   light   one light, short pulse (item placed in the bag)
 *   double  two light, short pulses (item bounced out of the bag)
 * The Vibration switch in Settings is checked on the TypeScript side.
 */
final class HapticsBridge {
    private HapticsBridge() {}

    private static Vibrator vibrator(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager m = (VibratorManager) c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return m != null ? m.getDefaultVibrator() : null;
        }
        return (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
    }

    static void play(String kind) {
        Activity a = com.cocos.lib.GlobalObject.getActivity();
        if (a == null) return;
        Vibrator v = vibrator(a);
        if (v == null || !v.hasVibrator()) return;
        boolean twice = "double".equals(kind);
        // a clearly felt but short buzz (the phone's own "click" effects were too faint to feel on
        // some phones): 40 ms, or two 35 ms pulses 90 ms apart
        long[] timing = twice ? new long[] { 0, 35, 90, 35 } : new long[] { 0, 40 };
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (v.hasAmplitudeControl()) {
                    int[] amp = twice ? new int[] { 0, 200, 0, 200 } : new int[] { 0, 200 };
                    v.vibrate(VibrationEffect.createWaveform(timing, amp, -1));
                } else {
                    v.vibrate(VibrationEffect.createWaveform(timing, -1));
                }
            } else {
                v.vibrate(timing, -1);
            }
        } catch (Exception ignored) { /* no permission / no vibrator: nothing */ }
    }
}

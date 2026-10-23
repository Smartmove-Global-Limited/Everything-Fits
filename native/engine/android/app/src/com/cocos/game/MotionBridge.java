package com.cocos.game;

import android.app.Activity;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

/**
 * Shaking the phone (TypeScript: assets/scripts/game/Shake.ts), like the web app: Android's linear
 * acceleration sensor, gravity already removed by the system (the browser's
 * DeviceMotionEvent.acceleration), so tilting the phone does not push the items. TypeScript reads
 * the latest values every frame with x() / y() (m/s², x right, y up the screen, portrait).
 * Listens only while the game is in front.
 */
public final class MotionBridge implements SensorEventListener {
    private static MotionBridge instance;
    private static volatile float ax, ay;

    private final SensorManager sensors;
    private final Sensor linear;

    private MotionBridge(Activity a) {
        sensors = (SensorManager) a.getSystemService(Context.SENSOR_SERVICE);
        linear = sensors != null ? sensors.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) : null;
    }

    /** Called once from AppActivity.onCreate */
    static void init(Activity a) { instance = new MotionBridge(a); }

    static void resume() {
        if (instance == null || instance.linear == null) return;
        instance.sensors.registerListener(instance, instance.linear, SensorManager.SENSOR_DELAY_GAME);
    }

    static void pause() {
        if (instance == null || instance.linear == null) return;
        instance.sensors.unregisterListener(instance);
        ax = 0; ay = 0;
    }

    // ---------- from TypeScript (native.reflection, every frame: floats, no allocation) ----------
    /** true when the phone has a linear acceleration sensor */
    public static boolean available() { return instance != null && instance.linear != null; }
    public static float x() { return ax; }
    public static float y() { return ay; }

    @Override public void onSensorChanged(SensorEvent e) { ax = e.values[0]; ay = e.values[1]; }
    @Override public void onAccuracyChanged(Sensor s, int accuracy) {}
}

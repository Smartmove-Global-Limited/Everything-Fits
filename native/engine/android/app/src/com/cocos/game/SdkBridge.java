package com.cocos.game;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.os.Bundle;
import android.util.Log;

import com.appsflyer.AppsFlyerLib;
import com.appsflyer.share.AFAdRevenueData;
import com.appsflyer.share.AFInAppEventParameterName;
import com.appsflyer.share.AFInAppEventType;
import com.appsflyer.share.AdRevenueScheme;
import com.appsflyer.share.MediationNetwork;
import com.applovin.mediation.MaxAd;
import com.google.firebase.analytics.FirebaseAnalytics;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Native side of the game's analytics, ads and purchases (TypeScript: assets/scripts/services/NativeBridge.ts).
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
    /** paper-coloured cover over the GL surface until the game has drawn its first frame */
    private static View launchCover;

    private SdkBridge() {}

    /**
     * The GL surface is black until the engine draws its first frame: cover it with the game's paper
     * colour (same as the window background) so the launch goes cream → splash, no black flash.
     */
    public static void showLaunchCover(Activity activity) {
        launchCover = new View(activity);
        launchCover.setBackgroundColor(Color.parseColor("#D9CFBE"));
        activity.addContentView(launchCover, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** From TypeScript once the splash is on screen */
    public static void hideLaunchCover() {
        final Activity a = com.cocos.lib.GlobalObject.getActivity();
        if (a == null || launchCover == null) return;
        a.runOnUiThread(() -> {
            if (launchCover == null) return;
            ViewGroup parent = (ViewGroup) launchCover.getParent();
            if (parent != null) parent.removeView(launchCover);
            launchCover = null;
        });
    }

    /** Called once from AppActivity.onCreate */
    public static void init(Activity activity) {
        firebase = FirebaseAnalytics.getInstance(activity);
        int id = activity.getResources().getIdentifier("af_dev_key", "string", activity.getPackageName());
        String key = id != 0 ? activity.getString(id) : "";
        BillingBridge.init(activity);
        AdsBridge.init(activity);
        if (key == null || key.isEmpty()) { Log.w(TAG, "AppsFlyer: no Dev Key, not sending"); return; }
        try {
            AppsFlyerLib af = AppsFlyerLib.getInstance();
            af.init(key, null, activity.getApplicationContext());
            // device / debug builds: AppsFlyer logs its requests and the server answers (logcat AppsFlyer_*).
            // After init: before it, SDK 7.0.4's logger has no context and logs an NPE.
            int dbg = activity.getResources().getIdentifier("log_advertising_id", "bool", activity.getPackageName());
            if (dbg != 0 && activity.getResources().getBoolean(dbg)) af.setDebugLog(true);
            // SDK 7: init() no longer opens the session; start() has no arguments and must wait for the
            // session-ready callback. The launcher's referrer extras are read before that first start.
            af.collectDataFromLauncherActivity(activity);
            af.registerSessionReadyListener(af::start);
            appsFlyerOn = true;
        } catch (Exception e) {
            Log.e(TAG, "AppsFlyer init failed", e);   // attribution must never stop the game from opening
        }
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
            boolean purchase = "purchase".equals(name);
            if (firebase != null) {
                if (purchase) {
                    firebase.logEvent(FirebaseAnalytics.Event.PURCHASE, ga4Purchase(json));
                    Log.i(TAG, "purchase " + json.opt("value") + " " + json.optString("currency") + " " + json.optString("item_id") + " " + json.optString("transaction_id"));
                } else firebase.logEvent(name, bundle);
            }
            if (appsFlyerOn) {
                // AppsFlyer books purchase revenue only from its own af_purchase event with af_revenue /
                // af_currency, so a purchase goes to it under that scheme
                if (purchase) {
                    AppsFlyerLib.getInstance().logEvent(com.cocos.lib.GlobalObject.getActivity(), AFInAppEventType.PURCHASE, afPurchase(json));
                    Log.i(TAG, "af_purchase " + json.opt("value") + " " + json.optString("currency") + " " + json.optString("item_id"));
                } else {
                    AppsFlyerLib.getInstance().logEvent(com.cocos.lib.GlobalObject.getActivity(), name, values);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "logEvent " + name + " failed", e);
        }
    }

    /**
     * purchase { transaction_id, value, currency, item_id, item_name, item_category, quantity, source }
     * (Analytics.purchase) as GA4's recommended purchase event: transaction_id, value, currency and the
     * items list (one item: the store product, priced at what Play charged)
     */
    private static Bundle ga4Purchase(JSONObject p) {
        double value = p.optDouble("value", 0);
        Bundle item = new Bundle();
        item.putString(FirebaseAnalytics.Param.ITEM_ID, p.optString("item_id", ""));
        item.putString(FirebaseAnalytics.Param.ITEM_NAME, p.optString("item_name", ""));
        item.putString(FirebaseAnalytics.Param.ITEM_CATEGORY, p.optString("item_category", ""));
        item.putDouble(FirebaseAnalytics.Param.PRICE, value);
        item.putLong(FirebaseAnalytics.Param.QUANTITY, p.optLong("quantity", 1));
        Bundle b = new Bundle();
        String tx = p.optString("transaction_id", "");
        b.putString(FirebaseAnalytics.Param.TRANSACTION_ID, tx.length() > 100 ? tx.substring(0, 100) : tx);   // GA4 cuts values at 100
        b.putDouble(FirebaseAnalytics.Param.VALUE, value);
        b.putString(FirebaseAnalytics.Param.CURRENCY, p.optString("currency", "USD"));
        b.putParcelableArray(FirebaseAnalytics.Param.ITEMS, new Bundle[] { item });
        b.putString("source", p.optString("source", ""));
        return b;
    }

    /** The same purchase in AppsFlyer's purchase scheme (af_purchase) */
    private static Map<String, Object> afPurchase(JSONObject p) {
        Map<String, Object> m = new HashMap<>();
        m.put(AFInAppEventParameterName.REVENUE, p.optDouble("value", 0));
        m.put(AFInAppEventParameterName.CURRENCY, p.optString("currency", "USD"));
        m.put(AFInAppEventParameterName.CONTENT_ID, p.optString("item_id", ""));
        m.put(AFInAppEventParameterName.CONTENT_TYPE, p.optString("item_category", ""));
        m.put(AFInAppEventParameterName.QUANTITY, 1);
        m.put(AFInAppEventParameterName.ORDER_ID, p.optString("transaction_id", ""));
        m.put("source", p.optString("source", ""));
        return m;
    }

    /**
     * Impression-level ad revenue of every paid MAX impression (AdsBridge revenue listeners), MAX
     * reports it in USD:
     *   Firebase / GA4: ad_impression with is_show 1 (AdEvents)
     *   AppsFlyer:      logAdRevenue ("Impression-level (SDK)" integration), sent as af_ad_revenue
     */
    static void logAdRevenue(MaxAd ad) {
        if (ad == null) return;
        String placement = ad.getPlacement();   // the placement given to showAd / setPlacement
        double revenue = ad.getRevenue();
        String network = ad.getNetworkName();
        String format = ad.getFormat() == null ? "" : ad.getFormat().getLabel();
        AdEvents.impression(ad.getFormat(), true, network, ad.getAdUnitId(), placement, Math.max(0, revenue));   // < 0: MAX could not tell
        if (!appsFlyerOn) return;
        if (revenue <= 0 || network == null || network.isEmpty()) return;   // MAX had no figure for it
        try {
            Map<String, Object> extra = new HashMap<>();
            extra.put(AdRevenueScheme.AD_UNIT, ad.getAdUnitId());
            extra.put(AdRevenueScheme.AD_TYPE, format);
            extra.put(AdRevenueScheme.PLACEMENT, placement == null ? "" : placement);
            AppsFlyerLib.getInstance().logAdRevenue(new AFAdRevenueData(network, MediationNetwork.APPLOVIN_MAX, "USD", revenue), extra);
            Log.i(TAG, "af_ad_revenue " + revenue + " USD " + network + " " + extra.get(AdRevenueScheme.AD_TYPE) + " " + placement);
        } catch (Exception e) {
            Log.w(TAG, "AppsFlyer logAdRevenue failed", e);
        }
    }

    /** Firebase / GA4 event with a ready bundle (AdEvents) */
    static void firebaseLog(String name, Bundle params) {
        if (firebase == null) return;
        try { firebase.logEvent(name, params); } catch (Exception e) { Log.w(TAG, "Firebase " + name + " failed", e); }
    }

    // ---------- ads (AdsBridge), billing (BillingBridge), remote config (RemoteConfigBridge) ----------
    // Called from TypeScript (NativeBridge.ts): static void methods with String arguments only.
    public static void adsHello() { AdsBridge.hello(); }
    public static void adsShowBanner(String placement) { AdsBridge.showBanner(placement); }
    public static void adsHideBanner() { AdsBridge.hideBanner(); }
    public static void adsShowInter(String placement) { AdsBridge.showInter(placement); }
    public static void adsShowRewarded(String placement) { AdsBridge.showRewarded(placement); }
    /** user_ad_request (AdEvents): format "inter" | "rewarded", limited "1" when the game's rules hold the ad back */
    public static void adsUserRequest(String format, String placement, String limited) { AdsBridge.userRequest(format, placement, "1".equals(limited)); }
    public static void billingSetup(String catalogueJson) { BillingBridge.setup(catalogueJson); }
    public static void billingBuy(String productId) { BillingBridge.buy(productId); }
    public static void billingFakeBuy(String productId, String name, String price) { BillingBridge.fakeBuy(productId, name, price); }
    public static void billingFinish(String token, String consumable) { BillingBridge.finish(token, consumable); }
    public static void billingRestore() { BillingBridge.restore(); }
    public static void remoteConfigFetch(String keysJson) { RemoteConfigBridge.fetch(keysJson); }
    public static void haptic(String kind) { HapticsBridge.play(kind); }
}

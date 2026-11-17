package com.cocos.game;

import android.os.Bundle;
import android.util.Log;

import com.applovin.mediation.MaxAd;
import com.applovin.mediation.MaxAdFormat;

/**
 * The five ad events of the team's tracking sheet (Ads), sent to Firebase / GA4. Every one carries
 * ad_format, ad_platform and ad_source; placement only on interstitials and rewarded ads.
 *
 *   user_ad_request  the player taps a "watch an ad" button (rewarded), or play reaches a spot where an
 *                    interstitial may show (TypeScript asks: AdsBridge.userRequest). is_load = an ad
 *                    is ready, load_time = how long that load took, is_limited = the game's rules held
 *                    the interstitial back (caps, pacing, No Ads, tutorial) or another ad is on screen
 *   ad_request       a load ended (MAX listeners onAdLoaded / onAdLoadFailed, banner refreshes
 *                    included): is_load 1 | 0, load_time = MAX's request latency (ms)
 *   ad_impression    shown (is_show 1, from the revenue callback, value = USD revenue) or a call to show
 *                    an interstitial / rewarded ad ended without one (is_show 0, value 0)
 *   ad_user_click    the player clicked the ad
 *   ad_complete      a full-screen ad closed: ad_duration (ms on screen), end_type done | quit (rewarded)
 *
 * ad_platform is "Max" (the mediation), ad_source the network that served (AppLovin's network names:
 * "Google AdMob", "Mintegral"…), ad_unit_id the MAX ad unit id (on ad_impression also as GA4's
 * ad_unit_name, for its ad revenue reports).
 */
final class AdEvents {
    private static final String TAG = "AdEvents";
    private static final String PLATFORM = "Max";

    private AdEvents() {}

    /** MAX's format in the tracking sheet's words */
    static String format(MaxAdFormat f) {
        if (f == null) return "";
        if (f == MaxAdFormat.BANNER || f == MaxAdFormat.LEADER) return "banner";
        if (f == MaxAdFormat.INTERSTITIAL) return "interstitial";
        if (f == MaxAdFormat.REWARDED) return "video_rewarded";
        if (f == MaxAdFormat.MREC) return "mrec";
        if (f == MaxAdFormat.NATIVE) return "native";
        if (f == MaxAdFormat.APP_OPEN) return "app_open";
        return f.getLabel().toLowerCase();
    }

    private static boolean fullScreen(String f) { return "interstitial".equals(f) || "video_rewarded".equals(f); }

    /** ad_format · ad_platform · ad_source (+ ad_unit_id) */
    private static Bundle base(MaxAdFormat format, String network, String unitId) {
        Bundle p = new Bundle();
        p.putString("ad_format", format(format));
        p.putString("ad_platform", PLATFORM);
        p.putString("ad_source", network == null ? "" : network);
        if (unitId != null) p.putString("ad_unit_id", unitId);
        return p;
    }
    private static void placement(Bundle p, String placement) {
        if (fullScreen(p.getString("ad_format")) && placement != null && !placement.isEmpty()) p.putString("placement", placement);
    }
    private static void send(String name, Bundle p) {
        SdkBridge.firebaseLog(name, p);
        Log.i(TAG, name + " " + p);
    }

    static void userRequest(MaxAdFormat format, String unitId, boolean ready, MaxAd loaded, long loadMs, boolean limited, String placement) {
        Bundle p = base(format, loaded == null ? "" : loaded.getNetworkName(), unitId);
        p.putLong("is_load", ready ? 1 : 0);
        p.putLong("load_time", Math.max(0, loadMs));
        p.putLong("is_limited", limited ? 1 : 0);
        placement(p, placement);
        send("user_ad_request", p);
    }

    static void request(MaxAdFormat format, boolean loaded, String network, long latencyMs) {
        Bundle p = base(format, network, null);
        p.putLong("is_load", loaded ? 1 : 0);
        p.putLong("load_time", Math.max(0, latencyMs));
        send("ad_request", p);
    }

    static void impression(MaxAdFormat format, boolean shown, String network, String unitId, String placement, double revenueUsd) {
        Bundle p = base(format, network, unitId);
        p.putString("ad_unit_name", unitId == null ? "" : unitId);
        placement(p, placement);
        p.putLong("is_show", shown ? 1 : 0);
        p.putDouble("value", shown ? Math.max(0, revenueUsd) : 0);
        p.putString("currency", "USD");
        send("ad_impression", p);
    }

    static void click(MaxAd ad) {
        if (ad == null) return;
        Bundle p = base(ad.getFormat(), ad.getNetworkName(), ad.getAdUnitId());
        placement(p, ad.getPlacement());
        send("ad_user_click", p);
    }

    /** endType: "done" | "quit" for a rewarded ad, null otherwise */
    static void complete(MaxAd ad, long durationMs, String endType) {
        if (ad == null) return;
        Bundle p = base(ad.getFormat(), ad.getNetworkName(), ad.getAdUnitId());
        if (endType != null) p.putString("end_type", endType);
        p.putLong("ad_duration", Math.max(0, durationMs));
        placement(p, ad.getPlacement());
        send("ad_complete", p);
    }
}

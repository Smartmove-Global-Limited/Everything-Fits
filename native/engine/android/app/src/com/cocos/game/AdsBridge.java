package com.cocos.game;

import android.app.Activity;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;

import com.applovin.mediation.MaxAd;
import com.applovin.mediation.MaxAdListener;
import com.applovin.mediation.MaxAdViewAdListener;
import com.applovin.mediation.MaxError;
import com.applovin.mediation.MaxReward;
import com.applovin.mediation.MaxRewardedAdListener;
import com.applovin.mediation.ads.MaxAdView;
import com.applovin.mediation.ads.MaxInterstitialAd;
import com.applovin.mediation.ads.MaxRewardedAd;
import com.applovin.sdk.AppLovinMediationProvider;
import com.applovin.sdk.AppLovinSdk;
import com.applovin.sdk.AppLovinSdkInitializationConfiguration;
import com.applovin.sdk.AppLovinSdkUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * AppLovin MAX: banner, interstitial and rewarded (TypeScript: assets/scripts/services/Ads.ts).
 * Keys come from applovin.properties next to the Android project (NOT in git), turned into string
 * resources by app/build.gradle. Without an SDK key the bridge reports mode "off" and the game keeps
 * its simulated "TEST AD" screens. Every rule (pacing, No Ads, tutorial…) lives in TypeScript; this
 * class only loads, shows and reports.
 * Events to TypeScript, channel "ads": ready{mode} · banner{state,heightPx,screenPx} ·
 * inter{state: loaded|failed|shown|closed|showFailed} · rewarded{state: loaded|failed|closed|showFailed, rewarded}
 */
final class AdsBridge {
    private static final String TAG = "AdsBridge";
    private static final int RETRY_MAX_SEC = 64;

    private static Activity activity;
    private static boolean ready;
    private static String mode = "pending";
    private static String bannerUnit, interUnit, rewardedUnit;

    private static MaxAdView banner;
    /** banner + the strip under it down to the screen edge (behind the navigation bar) */
    private static FrameLayout bannerBox;
    private static int bannerHeight;
    private static boolean bannerWanted;
    private static MaxInterstitialAd inter;
    private static MaxRewardedAd rewarded;
    private static boolean rewardEarned;
    private static int interRetry, rewardedRetry;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private AdsBridge() {}

    private static String res(Activity a, String name) {
        int id = a.getResources().getIdentifier(name, "string", a.getPackageName());
        return id != 0 ? a.getString(id).trim() : "";
    }

    /** Called once from AppActivity.onCreate */
    static void init(Activity a) {
        activity = a;
        String sdkKey = res(a, "applovin_sdk_key");
        bannerUnit = res(a, "applovin_banner_unit");
        interUnit = res(a, "applovin_inter_unit");
        rewardedUnit = res(a, "applovin_rewarded_unit");
        int offId = a.getResources().getIdentifier("ads_off", "bool", a.getPackageName());
        if (offId != 0 && a.getResources().getBoolean(offId)) { mode = "disabled"; Log.w(TAG, "adsOff in applovin.properties: no banner / interstitial"); report(); return; }
        if (sdkKey.isEmpty()) { mode = "off"; Log.w(TAG, "no AppLovin SDK key: simulated ads"); report(); return; }
        int logId = a.getResources().getIdentifier("log_advertising_id", "bool", a.getPackageName());
        if (logId != 0 && a.getResources().getBoolean(logId)) logAdvertisingId(a);   // device / debug builds
        List<String> testIds = new ArrayList<>();
        for (String s : res(a, "applovin_test_devices").split(",")) if (!s.trim().isEmpty()) testIds.add(s.trim());
        AppLovinSdkInitializationConfiguration cfg = AppLovinSdkInitializationConfiguration.builder(sdkKey)
                .setMediationProvider(AppLovinMediationProvider.MAX)
                .setTestDeviceAdvertisingIds(testIds)
                .build();
        AppLovinSdk.getInstance(a).initialize(cfg, conf -> {
            ready = true; mode = "max";
            if (!interUnit.isEmpty()) createInter();
            if (!rewardedUnit.isEmpty()) createRewarded();
            if (!bannerUnit.isEmpty()) createBanner();
            report();
        });
    }

    /** Device / debug builds: print this phone's advertising id, for testDevices in applovin.properties */
    private static void logAdvertisingId(Activity a) {
        new Thread(() -> {
            try {   // reflection: Play services ads-identifier comes with the AdMob adapter only
                Object info = Class.forName("com.google.android.gms.ads.identifier.AdvertisingIdClient")
                        .getMethod("getAdvertisingIdInfo", android.content.Context.class).invoke(null, a);
                Log.i(TAG, "advertising id (testDevices): " + info.getClass().getMethod("getId").invoke(info));
            } catch (Throwable e) { Log.w(TAG, "advertising id unavailable: " + e); }
        }).start();
    }

    /**
     * ready, with where the banner will go (its height and the system bar under it, screen height,
     * in px), so the game keeps its place before any ad loads
     */
    private static void report() {
        main.post(() -> {
            View root = activity.getWindow().getDecorView();
            ScriptEvents.send("ads", ScriptEvents.of("ready", "mode", mode,
                    "bannerPx", AppLovinSdkUtils.dpToPx(activity, 50), "systemPx", navigationBarInset(), "screenPx", root.getHeight()));
        });
    }

    /** TypeScript asks again once its listener is attached (the SDK may have been ready before) */
    static void hello() { report(); }

    // ---------- banner ----------
    private static void createBanner() {
        banner = new MaxAdView(bannerUnit, activity);
        banner.setRevenueListener(SdkBridge::logAdRevenue);   // each paid impression → AppsFlyer af_ad_revenue
        banner.setListener(new MaxAdViewAdListener() {
            @Override public void onAdLoaded(MaxAd ad) { ScriptEvents.send("ads", ScriptEvents.of("banner", "state", "loaded")); }
            @Override public void onAdLoadFailed(String unit, MaxError e) { Log.w(TAG, "banner failed " + e.getCode()); }
            @Override public void onAdDisplayed(MaxAd ad) {}
            @Override public void onAdHidden(MaxAd ad) {}
            @Override public void onAdClicked(MaxAd ad) {}
            @Override public void onAdDisplayFailed(MaxAd ad, MaxError e) {}
            @Override public void onAdExpanded(MaxAd ad) {}
            @Override public void onAdCollapsed(MaxAd ad) {}
        });
        bannerHeight = AppLovinSdkUtils.dpToPx(activity, 50);
        // just the banner, right above the navigation / gesture bar (nothing over the system bar).
        // Transparent until an ad loads: the game's black "AD" strip shows through (Overlays.ts)
        bannerBox = new FrameLayout(activity);
        bannerBox.setVisibility(View.GONE);
        bannerBox.addView(banner, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, bannerHeight, Gravity.TOP));
        activity.addContentView(bannerBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, bannerHeight, Gravity.BOTTOM));
        banner.stopAutoRefresh();
        banner.loadAd();
    }

    /** Edge-to-edge: the banner sits above the gesture / navigation bar */
    private static int navigationBarInset() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return 0;
        WindowInsets ins = activity.getWindow().getDecorView().getRootWindowInsets();
        return ins != null ? ins.getSystemWindowInsetBottom() : 0;
    }

    static void showBanner(final String placement) {
        main.post(() -> {
            bannerWanted = true;
            if (banner == null) return;
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) bannerBox.getLayoutParams();
            lp.bottomMargin = navigationBarInset();
            bannerBox.setLayoutParams(lp);
            banner.setPlacement(placement);
            bannerBox.setVisibility(View.VISIBLE);
            banner.startAutoRefresh();
            ScriptEvents.send("ads", ScriptEvents.of("banner", "state", "shown"));
        });
    }

    static void hideBanner() {
        main.post(() -> {
            bannerWanted = false;
            if (banner == null) return;
            bannerBox.setVisibility(View.GONE);
            banner.stopAutoRefresh();
            ScriptEvents.send("ads", ScriptEvents.of("banner", "state", "hidden"));
        });
    }

    // ---------- interstitial ----------
    private static void createInter() {
        inter = new MaxInterstitialAd(interUnit, activity);
        inter.setRevenueListener(SdkBridge::logAdRevenue);
        inter.setListener(new MaxAdListener() {
            @Override public void onAdLoaded(MaxAd ad) { interRetry = 0; ScriptEvents.send("ads", ScriptEvents.of("inter", "state", "loaded")); }
            @Override public void onAdLoadFailed(String unit, MaxError e) {
                interRetry = Math.min(interRetry + 1, 6);
                main.postDelayed(() -> inter.loadAd(), 1000L * Math.min(RETRY_MAX_SEC, 1 << interRetry));
            }
            @Override public void onAdDisplayed(MaxAd ad) { ScriptEvents.send("ads", ScriptEvents.of("inter", "state", "shown")); }
            @Override public void onAdHidden(MaxAd ad) { ScriptEvents.send("ads", ScriptEvents.of("inter", "state", "closed")); inter.loadAd(); }
            @Override public void onAdClicked(MaxAd ad) {}
            @Override public void onAdDisplayFailed(MaxAd ad, MaxError e) { ScriptEvents.send("ads", ScriptEvents.of("inter", "state", "showFailed")); inter.loadAd(); }
        });
        inter.loadAd();
    }

    static void showInter(final String placement) {
        main.post(() -> {
            if (inter != null && inter.isReady()) inter.showAd(placement);
            else ScriptEvents.send("ads", ScriptEvents.of("inter", "state", "showFailed"));
        });
    }

    // ---------- rewarded ----------
    private static void createRewarded() {
        rewarded = MaxRewardedAd.getInstance(rewardedUnit, activity);
        rewarded.setRevenueListener(SdkBridge::logAdRevenue);
        rewarded.setListener(new MaxRewardedAdListener() {
            @Override public void onAdLoaded(MaxAd ad) { rewardedRetry = 0; ScriptEvents.send("ads", ScriptEvents.of("rewarded", "state", "loaded")); }
            @Override public void onAdLoadFailed(String unit, MaxError e) {
                rewardedRetry = Math.min(rewardedRetry + 1, 6);
                main.postDelayed(() -> rewarded.loadAd(), 1000L * Math.min(RETRY_MAX_SEC, 1 << rewardedRetry));
            }
            @Override public void onAdDisplayed(MaxAd ad) { rewardEarned = false; }
            @Override public void onUserRewarded(MaxAd ad, MaxReward reward) { rewardEarned = true; }
            @Override public void onAdHidden(MaxAd ad) {
                ScriptEvents.send("ads", ScriptEvents.of("rewarded", "state", "closed", "rewarded", rewardEarned));
                rewardEarned = false;
                rewarded.loadAd();
            }
            @Override public void onAdClicked(MaxAd ad) {}
            @Override public void onAdDisplayFailed(MaxAd ad, MaxError e) {
                ScriptEvents.send("ads", ScriptEvents.of("rewarded", "state", "showFailed"));
                rewarded.loadAd();
            }
        });
        rewarded.loadAd();
    }

    static void showRewarded(final String placement) {
        main.post(() -> {
            if (rewarded != null && rewarded.isReady()) rewarded.showAd(placement);
            else ScriptEvents.send("ads", ScriptEvents.of("rewarded", "state", "showFailed"));
        });
    }
}

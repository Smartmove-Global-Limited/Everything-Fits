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
import com.applovin.mediation.MaxAdFormat;
import com.applovin.mediation.MaxAdViewConfiguration;
import com.applovin.mediation.MaxAdListener;
import com.applovin.mediation.MaxAdViewAdListener;
import com.applovin.mediation.MaxAdWaterfallInfo;
import com.applovin.mediation.MaxNetworkResponseInfo;
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
    /**
     * Banner loading, one owner at a time: until an ad has loaded, this code loads it (one load at a
     * time, retried while the banner is wanted on screen, at once when a screen shows it); from the
     * first ad on, MAX's auto refresh replaces it (a failed refresh keeps the ad on screen).
     */
    private static boolean bannerLoaded, bannerLoading;
    private static int bannerRetry;
    private static final int BANNER_RETRY_MAX_SEC = 30;
    private static final Runnable bannerReload = () -> { if (bannerWanted) loadBanner(); };
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
                    "bannerPx", bannerHeight > 0 ? bannerHeight : adaptiveBannerPx(), "systemPx", navigationBarInset(), "screenPx", root.getHeight()));
        });
    }

    /** TypeScript asks again once its listener is attached (the SDK may have been ready before) */
    static void hello() { report(); }

    // ---------- banner ----------
    private static void createBanner() {
        // anchored adaptive banner (fills the width, pays better than the fixed 320x50), set the way
        // SDK 13 wants it: MaxAdViewConfiguration (the old "adaptive_banner" extra parameter is refused)
        banner = new MaxAdView(bannerUnit, MaxAdFormat.BANNER, MaxAdViewConfiguration.builder()
                .setAdaptiveType(MaxAdViewConfiguration.AdaptiveType.ANCHORED).build());
        banner.setRevenueListener(SdkBridge::logAdRevenue);   // each paid impression → AppsFlyer af_ad_revenue
        banner.setListener(new MaxAdViewAdListener() {
            @Override public void onAdLoaded(MaxAd ad) {
                Log.i(TAG, "banner loaded from " + ad.getNetworkName() + " (" + ad.getNetworkPlacement() + "), revenue " + ad.getRevenue());
                logWaterfall("banner", ad.getWaterfall());
                boolean first = !bannerLoaded;
                bannerLoaded = true; bannerLoading = false; bannerRetry = 0; main.removeCallbacks(bannerReload);
                // MAX takes over from the first ad: its auto refresh while the banner is on screen
                if (first && bannerWanted) banner.startAutoRefresh();
                ScriptEvents.send("ads", ScriptEvents.of("banner", "state", "loaded"));
            }
            // The first ad failed (no fill 204, no network at start…): it used to be loaded once only,
            // so the strip stayed black for the whole session, gameplay included. Try again while a
            // screen wants it (2, 4, 8, 16, 30 s…); hidden, the next screen that shows it loads it.
            @Override public void onAdLoadFailed(String unit, MaxError e) {
                Log.w(TAG, "banner failed " + e.getCode() + " after " + e.getRequestLatencyMillis() + " ms" + (bannerLoaded ? " (refresh: the shown ad stays)" : ""));
                logWaterfall("banner", e.getWaterfall());
                bannerLoading = false;
                if (bannerLoaded || !bannerWanted) return;
                bannerRetry = Math.min(bannerRetry + 1, 5);
                main.removeCallbacks(bannerReload);
                main.postDelayed(bannerReload, 1000L * Math.min(BANNER_RETRY_MAX_SEC, 1 << bannerRetry));
            }
            @Override public void onAdDisplayed(MaxAd ad) {}
            @Override public void onAdHidden(MaxAd ad) {}
            @Override public void onAdClicked(MaxAd ad) {}
            @Override public void onAdDisplayFailed(MaxAd ad, MaxError e) {}
            @Override public void onAdExpanded(MaxAd ad) {}
            @Override public void onAdCollapsed(MaxAd ad) {}
        });
        // as tall as the SDK says for this screen's width (about 56-62 dp on a phone instead of a
        // fixed 50); the game's black strip takes the same height ("ready": bannerPx)
        bannerHeight = adaptiveBannerPx();
        // just the banner, right above the navigation / gesture bar (nothing over the system bar).
        // Transparent until an ad loads: the game's black strip shows through (Overlays.ts)
        bannerBox = new FrameLayout(activity);
        bannerBox.setVisibility(View.GONE);
        bannerBox.addView(banner, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, bannerHeight, Gravity.TOP));
        activity.addContentView(bannerBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, bannerHeight, Gravity.BOTTOM));
        banner.stopAutoRefresh();
        loadBanner();                                          // ready before the first screen asks for it
    }

    /**
     * Which networks MAX asked for an ad and what each answered (logcat -s AdsBridge): the network
     * that filled, the ones with no fill (204) or an error, and how long each took
     */
    static void logWaterfall(String what, MaxAdWaterfallInfo wf) {
        if (wf == null) { Log.i(TAG, what + " waterfall: none"); return; }
        Log.i(TAG, what + " waterfall " + wf.getName() + " / " + wf.getTestName() + ", " + wf.getLatencyMillis() + " ms:");
        for (MaxNetworkResponseInfo r : wf.getNetworkResponses()) {
            MaxError err = r.getError();
            Log.i(TAG, "  " + r.getMediatedNetwork().getName() + (r.isBidding() ? " (bidding)" : "") + ": " + r.getAdLoadState()
                    + ", " + r.getLatencyMillis() + " ms" + (err != null ? ", error " + err.getCode() + " " + err.getMessage() : ""));
        }
    }

    /** One load at a time, and only until the first ad: then MAX's auto refresh loads the next ones */
    private static void loadBanner() {
        if (banner == null || bannerLoaded || bannerLoading) return;
        bannerLoading = true;
        main.removeCallbacks(bannerReload);
        Log.i(TAG, "banner load");
        banner.loadAd();
    }

    /**
     * The navigation bar the banner must sit above: 0 while it is hidden (the game runs full screen,
     * AppActivity.hideSystemBars). getSystemWindowInsetBottom() still reported the hidden bar's
     * height (the immersive flags include LAYOUT_STABLE), which left a blank strip under the banner.
     */
    static int navigationBarInset() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return 0;
        View decor = activity.getWindow().getDecorView();
        // hidden by the game (AppActivity.hideSystemBars, set before the ads start): nothing under the
        // banner. Asked this way, not through the insets, which still reported the bar for a moment.
        if ((decor.getSystemUiVisibility() & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0) return 0;
        WindowInsets ins = decor.getRootWindowInsets();
        if (ins == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return ins.isVisible(WindowInsets.Type.navigationBars()) ? ins.getInsets(WindowInsets.Type.navigationBars()).bottom : 0;
        }
        return ins.getSystemWindowInsetBottom();
    }

    /** Height of the anchored adaptive banner for this screen's width, px (50 dp if the SDK cannot tell) */
    private static int adaptiveBannerPx() {
        int dp = 0;
        try { dp = MaxAdFormat.BANNER.getAdaptiveSize(activity).getHeight(); } catch (Throwable e) { /* older SDK */ }
        return AppLovinSdkUtils.dpToPx(activity, dp > 0 ? dp : 50);
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
            // an ad is there: MAX refreshes it; none yet (failed so far): load now, the player is
            // looking at the empty strip (nothing if a load is already on its way)
            if (bannerLoaded) banner.startAutoRefresh();
            else { bannerRetry = 0; loadBanner(); }
            // the system bar under it now (the bars may have been showing when "ready" was sent)
            ScriptEvents.send("ads", ScriptEvents.of("banner", "state", "shown", "systemPx", lp.bottomMargin));
        });
    }

    static void hideBanner() {
        main.post(() -> {
            bannerWanted = false;
            if (banner == null) return;
            bannerBox.setVisibility(View.GONE);
            banner.stopAutoRefresh();
            main.removeCallbacks(bannerReload);                // no retries while no screen shows it
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

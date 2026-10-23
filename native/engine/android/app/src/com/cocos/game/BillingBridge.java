package com.cocos.game;

import android.app.Activity;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play Billing (TypeScript: assets/scripts/services/Purchases.ts). TypeScript owns the
 * catalogue and the rewards; this class buys, reports and finishes:
 *   1. setup(catalogueJson)  → connects, reports prices and every unfinished purchase
 *   2. buy(productId, optionId) → Play purchase sheet; the result comes back as an event
 *   3. TypeScript grants the reward (once per purchase token) and calls finish(token, consumable):
 *      consumables are consumed, No Ads is acknowledged. Play refunds anything not acknowledged
 *      within 3 days, so an unfinished purchase is reported again at the next start.
 * Events to TypeScript, channel "billing": ready · prices{prices} · purchase{productId, token, orderId, fromFlow} ·
 * flowEnd{productId, result: cancelled|error|pending|unavailable} · owned{ids}
 */
final class BillingBridge {
    private static final String TAG = "BillingBridge";

    private static Activity activity;
    private static BillingClient client;
    private static boolean connected;
    private static final Map<String, ProductDetails> details = new HashMap<>();
    private static final Map<String, String> options = new HashMap<>();
    private static String pendingFlow;   // product id of the purchase sheet on screen

    private BillingBridge() {}

    static void init(Activity a) { activity = a; }

    /** From TypeScript once: [{"id":"fit.gold.500","option":"fit-gold-pack-500"}, …] */
    static void setup(String catalogueJson) {
        activity.runOnUiThread(() -> {
            try {
                JSONArray arr = new JSONArray(catalogueJson);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject p = arr.getJSONObject(i);
                    options.put(p.getString("id"), p.optString("option", ""));
                }
            } catch (Exception e) { Log.w(TAG, "bad catalogue", e); }
            if (client == null) {
                client = BillingClient.newBuilder(activity)
                        .setListener(BillingBridge::onPurchasesUpdated)
                        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                        .build();
            }
            connect();
        });
    }

    private static void connect() {
        if (connected) { afterConnect(); return; }
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) { Log.w(TAG, "setup " + r.getDebugMessage()); return; }
                connected = true;
                afterConnect();
            }
            @Override public void onBillingServiceDisconnected() { connected = false; }
        });
    }

    private static void afterConnect() {
        ScriptEvents.send("billing", ScriptEvents.of("ready"));
        queryDetails();
        queryOwned(false);
    }

    private static void queryDetails() {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String id : options.keySet()) {
            list.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        }
        if (list.isEmpty()) return;
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(), (r, result) -> {
            JSONObject prices = new JSONObject();
            for (ProductDetails d : result.getProductDetailsList()) {
                details.put(d.getProductId(), d);
                ProductDetails.OneTimePurchaseOfferDetails offer = offerFor(d);
                try { if (offer != null) prices.put(d.getProductId(), offer.getFormattedPrice()); } catch (Exception ignored) {}
            }
            ScriptEvents.send("billing", ScriptEvents.of("prices", "prices", prices));
        });
    }

    /** The purchase option named in the catalogue, else the product's first offer */
    private static ProductDetails.OneTimePurchaseOfferDetails offerFor(ProductDetails d) {
        List<ProductDetails.OneTimePurchaseOfferDetails> all = d.getOneTimePurchaseOfferDetailsList();
        String want = options.get(d.getProductId());
        if (all != null) {
            for (ProductDetails.OneTimePurchaseOfferDetails o : all) if (want != null && want.equals(o.getPurchaseOptionId())) return o;
            if (!all.isEmpty()) return all.get(0);
        }
        return d.getOneTimePurchaseOfferDetails();
    }

    /** Unfinished purchases (any product) and owned non-consumables. restore = player tapped Restore */
    private static void queryOwned(final boolean restore) {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (r, purchases) -> {
            JSONArray owned = new JSONArray();
            for (Purchase p : purchases) {
                if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                for (String id : p.getProducts()) owned.put(id);
                // not yet acknowledged / consumed: the reward may never have been granted
                if (!p.isAcknowledged()) report(p, false);
            }
            ScriptEvents.send("billing", ScriptEvents.of("owned", "ids", owned, "restore", restore));
        });
    }

    static void restore() {
        activity.runOnUiThread(() -> {
            if (client == null || !connected) { ScriptEvents.send("billing", ScriptEvents.of("owned", "ids", new JSONArray(), "restore", true, "error", true)); return; }
            queryOwned(true);
        });
    }

    static void buy(final String productId) {
        activity.runOnUiThread(() -> {
            ProductDetails d = details.get(productId);
            if (client == null || !connected || d == null) { flowEnd(productId, "unavailable"); return; }
            ProductDetails.OneTimePurchaseOfferDetails offer = offerFor(d);
            BillingFlowParams.ProductDetailsParams.Builder pb = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d);
            if (offer != null && offer.getOfferToken() != null) pb.setOfferToken(offer.getOfferToken());
            BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(pb.build())).build();
            pendingFlow = productId;
            BillingResult r = client.launchBillingFlow(activity, params);
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) { pendingFlow = null; flowEnd(productId, "error"); }
        });
    }

    private static void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        String flow = pendingFlow;
        pendingFlow = null;
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            boolean any = false;
            for (Purchase p : purchases) {
                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) { report(p, true); any = true; }
                else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING && flow != null) flowEnd(flow, "pending");
            }
            if (!any && flow != null) flowEnd(flow, "pending");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            if (flow != null) flowEnd(flow, "owned");
            queryOwned(false);
        } else if (flow != null) {
            flowEnd(flow, code == BillingClient.BillingResponseCode.USER_CANCELED ? "cancelled" : "error");
        }
    }

    private static void report(Purchase p, boolean fromFlow) {
        for (String id : p.getProducts()) {
            ScriptEvents.send("billing", ScriptEvents.of("purchase", "productId", id, "token", p.getPurchaseToken(),
                    "orderId", p.getOrderId() == null ? "" : p.getOrderId(), "fromFlow", fromFlow));
        }
    }

    private static void flowEnd(String productId, String result) {
        ScriptEvents.send("billing", ScriptEvents.of("flowEnd", "productId", productId, "result", result));
    }

    /** After TypeScript granted the reward: consume (consumables) or acknowledge (No Ads) */
    static void finish(final String token, final String consumable) {
        activity.runOnUiThread(() -> {
            if (client == null) return;
            if ("1".equals(consumable)) {
                client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(),
                        (r, t) -> { if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "consume " + r.getDebugMessage()); });
            } else {
                client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
                        r -> { if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "ack " + r.getDebugMessage()); });
            }
        });
    }
}

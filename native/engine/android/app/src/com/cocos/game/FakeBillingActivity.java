package com.cocos.game;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * TEMP (testers, Purchases.ts TEMP_FAKE_IAP): a stand-in for the Google Play purchase sheet. Opened
 * over the game like the real one (the game pauses and resumes the same way), nothing is charged:
 * Buy reports a purchase with a "fake-" token, Cancel / Back / a tap outside reports a cancel.
 */
public class FakeBillingActivity extends Activity {
    static final String EXTRA_ID = "id", EXTRA_NAME = "name", EXTRA_PRICE = "price";
    private boolean answered;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        final String id = getIntent().getStringExtra(EXTRA_ID);
        float dp = getResources().getDisplayMetrics().density;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0x99000000);
        root.setOnClickListener(v -> answer(id, false));

        LinearLayout sheet = new LinearLayout(this);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setPadding((int) (24 * dp), (int) (20 * dp), (int) (24 * dp), (int) (28 * dp));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadii(new float[] { 16 * dp, 16 * dp, 16 * dp, 16 * dp, 0, 0, 0, 0 });
        sheet.setBackground(bg);
        sheet.setClickable(true);   // taps on the sheet do not cancel

        sheet.addView(text("Google Play (TEST, no charge)", 13, 0xFF5F6368, false));
        sheet.addView(text(getIntent().getStringExtra(EXTRA_NAME), 20, 0xFF202124, true));
        sheet.addView(text(getIntent().getStringExtra(EXTRA_PRICE), 16, 0xFF202124, false));

        Button buy = new Button(this);
        buy.setText("Buy");
        buy.setTextColor(Color.WHITE);
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(0xFF01875F);
        bb.setCornerRadius(24 * dp);
        buy.setBackground(bb);
        buy.setOnClickListener(v -> answer(id, true));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (48 * dp));
        lp.topMargin = (int) (20 * dp);
        sheet.addView(buy, lp);

        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setBackgroundColor(Color.TRANSPARENT);
        cancel.setTextColor(0xFF01875F);
        cancel.setOnClickListener(v -> answer(id, false));
        sheet.addView(cancel, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (48 * dp)));

        root.addView(sheet, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(root);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s == null ? "" : s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, (int) (4 * getResources().getDisplayMetrics().density), 0, 0);
        return t;
    }

    private void answer(String id, boolean bought) {
        if (answered) return;
        answered = true;
        finish();
        BillingBridge.fakeResult(id, bought);
    }

    @Override
    public void onBackPressed() { answer(getIntent().getStringExtra(EXTRA_ID), false); }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (!answered) { answered = true; BillingBridge.fakeResult(getIntent().getStringExtra(EXTRA_ID), false); }
    }
}

package com.researchbot.android;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Apply postSplashScreenTheme before AppCompat/Capacitor initialize the activity.
        SplashScreen.installSplashScreen(this);
        registerPlugin(ResearchNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Debug builds only: lets scripts/android-background-exchange.mjs drive the real app without
        // instrumentation. Release APKs keep WebView debugging off (capacitor.config.ts).
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
    }
}

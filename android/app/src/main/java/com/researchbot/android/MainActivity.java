package com.researchbot.android;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Apply postSplashScreenTheme before AppCompat/Capacitor initialize the activity.
        SplashScreen.installSplashScreen(this);
        registerPlugin(ResearchNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

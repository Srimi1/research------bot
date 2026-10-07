package com.researchbot.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Runs only while the ChatGPT consent page is in front of Research Bot. A foreground service keeps
 * the app from being frozen or killed and keeps its network unblocked, so the loopback callback is
 * answered and the token exchange can reach OpenAI. It holds no credentials and does no work.
 */
public class SignInService extends Service {

    private static final String CHANNEL = "chatgpt-sign-in";
    private static final int NOTIFICATION = 7301;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            manager.createNotificationChannel(
                new NotificationChannel(CHANNEL, getString(R.string.sign_in_channel), NotificationManager.IMPORTANCE_LOW)
            );
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.sign_in_notification))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .build();
        // Android 14+ caps short services at a few minutes; older versions use the data sync type.
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
            : Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        try {
            ServiceCompat.startForeground(this, NOTIFICATION, notification, type);
        } catch (RuntimeException refused) {
            // Sign-in still works in front of the app; the exchange waits for the foreground anyway.
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId) {
        // The short-service limit was reached; the sign-in deadline handles the attempt itself.
        stopSelf();
    }

    @Override
    public void onTimeout(int startId, int foregroundServiceType) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

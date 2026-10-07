package com.researchbot.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ResultReceiver;

/** Keeps the loopback receiver alive while consent is open. Never restarted after a process kill. */
public class SignInService extends Service {
    private static final String CHANNEL = "chatgpt-signin";
    private static final int NOTIFICATION = 4040;
    // Also bound older Android releases, and stop before the API 34 shortService ANR deadline.
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable deadline = this::finish;

    @Override
    @SuppressWarnings("deprecation")
    public int onStartCommand(Intent intent, int flags, int startId) {
        ResultReceiver reply = intent == null ? null : (Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra("reply", ResultReceiver.class)
            : intent.getParcelableExtra("reply"));
        try {
            NotificationManager notifications = getSystemService(NotificationManager.class);
            notifications.createNotificationChannel(new NotificationChannel(
                CHANNEL, "ChatGPT sign-in", NotificationManager.IMPORTANCE_LOW
            ));
            Intent activity = new Intent(this, MainActivity.class).addFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
            PendingIntent returnToApp = PendingIntent.getActivity(
                this, 0, activity, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Connecting ChatGPT…")
                .setContentText("Return to Research Bot to finish sign-in.")
                .setContentIntent(returnToApp)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .build();
            if (Build.VERSION.SDK_INT >= 29) {
                int type = Build.VERSION.SDK_INT >= 34
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
                    : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                startForeground(NOTIFICATION, notification, type);
            } else startForeground(NOTIFICATION, notification);
            handler.removeCallbacks(deadline);
            handler.postDelayed(deadline, 175_000);
            // Do not let openBrowser run until startForeground has actually completed.
            if (reply != null) reply.send(0, null);
        } catch (RuntimeException error) {
            if (reply != null) reply.send(1, null);
            finish();
        }
        return START_NOT_STICKY;
    }

    private void finish() {
        handler.removeCallbacks(deadline);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onTimeout(int startId) {
        finish();
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        finish();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(deadline);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

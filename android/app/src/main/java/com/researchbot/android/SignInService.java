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
    private final Runnable deadline = this::expire;
    /** Result code sent to the plugin when the service stops because its deadline passed. */
    static final int RESULT_EXPIRED = 2;
    private ResultReceiver replyTo;

    @Override
    @SuppressWarnings("deprecation")
    public int onStartCommand(Intent intent, int flags, int startId) {
        ResultReceiver reply = intent == null ? null : (Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra("reply", ResultReceiver.class)
            : intent.getParcelableExtra("reply"));
        replyTo = reply;
        try {
            NotificationManager notifications = getSystemService(NotificationManager.class);
            notifications.createNotificationChannel(new NotificationChannel(
                CHANNEL, getString(R.string.sign_in_channel), NotificationManager.IMPORTANCE_LOW
            ));
            Intent activity = new Intent(this, MainActivity.class).addFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
            PendingIntent returnToApp = PendingIntent.getActivity(
                this, 0, activity, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(getString(R.string.sign_in_notification))
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

    /** Deadline or system timeout: stop, and let JS cancel the pending attempt and close its listener. */
    private void expire() {
        ResultReceiver reply = replyTo;
        replyTo = null;
        if (reply != null) reply.send(RESULT_EXPIRED, null);
        finish();
    }

    private void finish() {
        handler.removeCallbacks(deadline);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onTimeout(int startId) {
        expire();
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        expire();
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

package dev.rapina.herdrpocket;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class NotificationDismissReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PushManager.cancelSession(context, intent.getStringExtra("key"));
    }
}

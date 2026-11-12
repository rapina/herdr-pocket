package dev.rapina.herdrpocket;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.UUID;

/** ADB-only local notification fixture; excluded from release builds. */
public class PushFixtureReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        try {
            String key = intent.getStringExtra("key"), action = intent.getStringExtra("mode");
            if (key == null || !key.matches("[a-f0-9-]{36}")) throw new Exception("key required");
            NotificationManager manager = c.getSystemService(NotificationManager.class);
            SharedPreferences prefs = c.getSharedPreferences("push", Context.MODE_PRIVATE);
            if ("clear".equals(action)) {
                PushManager.cancelSession(c, key);
                JSONObject seen = new JSONObject(prefs.getString("seen", "{}")); seen.remove(key);
                prefs.edit().putString("seen", seen.toString()).commit();
            } else if ("tap".equals(action)) {
                for (StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() == key.hashCode()) {
                    n.getNotification().contentIntent.send(); manager.cancel(n.getId()); break;
                }
            } else {
                boolean enabled = prefs.getBoolean("enabled", false);
                prefs.edit().putBoolean("enabled", true).commit();
                try {
                    HashMap<String, String> data = new HashMap<>();
                    data.put("sessionKey", key); data.put("eventId", intent.getStringExtra("event") == null ? UUID.randomUUID().toString() : intent.getStringExtra("event"));
                    data.put("kind", intent.getStringExtra("kind"));
                    data.put("preview", intent.getStringExtra("preview"));
                    data.put("createdAt", Long.toString(intent.getLongExtra("at", System.currentTimeMillis())));
                    PushManager.show(c, data);
                } finally { prefs.edit().putBoolean("enabled", enabled).commit(); }
            }
            JSONObject result = new JSONObject(); int count = 0;
            for (StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() == key.hashCode()) {
                count++; result.put("when", n.getNotification().when).put("channel", n.getNotification().getChannelId());
                result.put("importance", manager.getNotificationChannel(n.getNotification().getChannelId()).getImportance());
                result.put("sound", manager.getNotificationChannel(n.getNotification().getChannelId()).getSound() != null);
                result.put("text", n.getNotification().extras.getCharSequence(android.app.Notification.EXTRA_TEXT));
                result.put("bigText", n.getNotification().extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT));
            }
            result.put("count", count);
            boolean summary = false;
            for (StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() == 0) summary = true;
            result.put("groupSummary", summary);
            setResultCode(0); setResultData(result.toString());
        } catch (Exception e) { setResultCode(1); setResultData("fixture failed"); }
    }
}

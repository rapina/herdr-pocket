package dev.rapina.herdrpocket;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

final class PushManager {
    static final ExecutorService work = Executors.newSingleThreadExecutor();
    private static final Object registrationLock = new Object();
    private static final int JOB = 7031;
    private static final String GROUP = "pocket.sessions";
    private static volatile boolean foreground;
    private static volatile String visibleKey = "";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("push", Context.MODE_PRIVATE); }
    static boolean permitted(Context c) {
        return (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    static synchronized void initialize(Context c) {
        try {
            String config = prefs(c).getString("options", "");
            if (config.isEmpty()) return;
            JSONObject o = new JSONObject(config);
            if (FirebaseApp.getApps(c).isEmpty()) FirebaseApp.initializeApp(c, new FirebaseOptions.Builder()
                .setApplicationId(o.getString("appId")).setProjectId(o.getString("projectId"))
                .setGcmSenderId(o.getString("senderId")).setApiKey(o.getString("apiKey")).build());
            FirebaseMessaging.getInstance().setAutoInitEnabled(prefs(c).getBoolean("enabled", false));
        } catch (Exception ignored) { }
    }
    static JSONObject status(Context c) throws Exception {
        return new JSONObject().put("enabled", prefs(c).getBoolean("enabled", false))
            .put("registered", prefs(c).getBoolean("registered", false)).put("permission", permitted(c));
    }
    private static JSONObject request(Context c, String path, JSONObject body) throws Exception {
        JSONObject call = new JSONObject().put("path", path).put("method", body == null ? "GET" : "POST");
        if (body != null) call.put("body", body);
        return ConnectionStore.get(c).request(call);
    }
    static JSONObject enable(Context c) throws Exception {
        synchronized (registrationLock) {
        if (!permitted(c)) throw new Exception("push_permission_denied");
        JSONObject result = request(c, "/v1/push/options", null);
        if (!result.optBoolean("available")) throw new Exception("push_not_configured");
        JSONObject options = result.getJSONObject("firebase");
        String old = prefs(c).getString("options", "");
        if (!old.isEmpty() && !new JSONObject(old).getString("appId").equals(options.getString("appId"))) {
            for (FirebaseApp app : FirebaseApp.getApps(c)) app.delete();
        }
        prefs(c).edit().putString("options", options.toString()).putBoolean("enabled", true)
            .putBoolean("registered", false).commit();
        initialize(c);
        try { register(c); }
        catch (Exception e) { scheduleRegistration(c); throw new Exception("push_registration_pending"); }
        return status(c);
    }
    }
    static void register(Context c) throws Exception {
        synchronized (registrationLock) {
        if (!prefs(c).getBoolean("enabled", false)) return;
        initialize(c);
        String token = Tasks.await(FirebaseMessaging.getInstance().getToken(), 20, TimeUnit.SECONDS);
        String id = prefs(c).getString("id", "");
        if (id.isEmpty()) { id = UUID.randomUUID().toString(); prefs(c).edit().putString("id", id).commit(); }
        request(c, "/v1/push/device", new JSONObject().put("id", id).put("token", token));
        prefs(c).edit().putBoolean("registered", true).putLong("registeredAt", System.currentTimeMillis()).commit();
    }
    }
    static void scheduleRegistration(Context c) {
        if (!prefs(c).getBoolean("enabled", false)) return;
        prefs(c).edit().putBoolean("registered", false).apply();
        c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(JOB, new ComponentName(c, PushRegistrationJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
    static JSONObject disable(Context c) throws Exception {
        synchronized (registrationLock) {
        prefs(c).edit().putBoolean("enabled", false).putBoolean("registered", false).commit();
        c.getSystemService(JobScheduler.class).cancel(JOB);
        c.getSystemService(NotificationManager.class).cancelAll();
        String id = prefs(c).getString("id", "");
        try { if (!id.isEmpty()) request(c, "/v1/push/remove", new JSONObject().put("id", id)); } catch (Exception ignored) { }
        try {
            if (!FirebaseApp.getApps(c).isEmpty()) {
                FirebaseMessaging.getInstance().setAutoInitEnabled(false);
                Tasks.await(FirebaseMessaging.getInstance().deleteToken(), 10, TimeUnit.SECONDS);
            }
        } catch (Exception ignored) { }
        visibleKey = "";
        prefs(c).edit().remove("routes").remove("seen").commit();
        return status(c);
    }
    }
    static void foreground(Context c, boolean value) {
        foreground = value;
        if (value && System.currentTimeMillis() - prefs(c).getLong("registeredAt", 0) > 86400000) scheduleRegistration(c);
    }
    static synchronized void context(Context c, JSONObject data) throws Exception {
        visibleKey = data.optString("visibleKey", "");
        JSONObject routes = new JSONObject(prefs(c).getString("routes", "{}"));
        JSONArray incoming = data.optJSONArray("routes");
        if (incoming != null) for (int i = 0; i < Math.min(200, incoming.length()); i++) {
            JSONObject route = incoming.getJSONObject(i);
            String key = route.optString("key"), title = route.optString("title");
            if (validId(key)) routes.put(key, title.substring(0, Math.min(120, title.length())));
        }
        while (routes.length() > 200) routes.remove(routes.keys().next());
        prefs(c).edit().putString("routes", routes.toString()).putString("language", data.optString("language", "ko")).apply();
        if (foreground && validId(visibleKey)) cancelSession(c, visibleKey);
    }
    static void cancelSession(Context c, String key) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        int cancelled = validId(key) ? key.hashCode() : 0;
        if (cancelled != 0) manager.cancel(cancelled);
        int count = 0;
        for (android.service.notification.StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() != 0 && n.getId() != cancelled) count++;
        // Cancelling a group summary can also cancel its remaining children.
        if (count == 0) manager.cancel(0);
    }
    private static boolean validId(String value) { return value != null && value.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"); }
    private static void channels(Context c, boolean ko) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        for (String kind : new String[]{"input", "done", "error"}) {
            String name = kind.equals("input") ? (ko ? "입력 대기" : "Input needed") : kind.equals("done") ? (ko ? "응답 완료" : "Response ready") : (ko ? "실행 오류" : "Execution error");
            NotificationChannel channel = new NotificationChannel("pocket_" + kind, name, kind.equals("done") ? NotificationManager.IMPORTANCE_LOW : NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(!kind.equals("done"));
            if (kind.equals("done")) channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
    }
    static synchronized void show(Context c, Map<String, String> data) {
        if (!prefs(c).getBoolean("enabled", false) || !permitted(c)) return;
        String key = data.get("sessionKey"), event = data.get("eventId"), kind = data.get("kind");
        if (!validId(key) || !validId(event) || !("input".equals(kind) || "done".equals(kind) || "error".equals(kind))) return;
        try {
            long at = Long.parseLong(data.get("createdAt")), now = System.currentTimeMillis();
            if (now - at > 900000 || at - now > 300000) return;
            JSONObject seen = new JSONObject(prefs(c).getString("seen", "{}"));
            if (at <= seen.optLong(key, 0)) return;
            seen.put(key, at);
            while (seen.length() > 200) seen.remove(seen.keys().next());
            prefs(c).edit().putString("seen", seen.toString()).commit();
            if (foreground && key.equals(visibleKey)) return;
            boolean ko = !prefs(c).getString("language", "ko").equals("en");
            channels(c, ko);
            String title = new JSONObject(prefs(c).getString("routes", "{}")).optString(key, "Herdr Pocket");
            String text = kind.equals("input") ? (ko ? "입력이 필요해요" : "Input needed") : kind.equals("done") ? (ko ? "응답이 도착했어요" : "Response ready") : (ko ? "실행 오류" : "Execution error");
            String preview = data.get("preview");
            if (kind.equals("done") && preview != null && !preview.trim().isEmpty()) text = preview.trim();
            Intent intent = new Intent(c, MainActivity.class).setData(Uri.parse("pocket://notification/" + key))
                .putExtra("notificationKey", key).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pending = PendingIntent.getActivity(c, key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            PendingIntent dismissed = PendingIntent.getBroadcast(c, key.hashCode(), new Intent(c, NotificationDismissReceiver.class).setData(Uri.parse("pocket://dismiss/" + key)).putExtra("key", key), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new Notification.Builder(c, "pocket_" + kind).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title).setContentText(text).setContentIntent(pending).setDeleteIntent(dismissed).setAutoCancel(true)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(kind.equals("input") ? Notification.CATEGORY_MESSAGE : Notification.CATEGORY_STATUS)
                .setGroup(GROUP).setShowWhen(true).setWhen(at).build();
            NotificationManager manager = c.getSystemService(NotificationManager.class);
            int count = 1;
            for (android.service.notification.StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() != 0 && n.getId() != key.hashCode()) count++;
            manager.notify(key.hashCode(), notification);
            if (count > 1) manager.notify(0, new Notification.Builder(c, "pocket_done").setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Herdr Pocket").setGroup(GROUP).setGroupSummary(true).setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN).setAutoCancel(true).build());
        } catch (Exception ignored) { }
    }
}

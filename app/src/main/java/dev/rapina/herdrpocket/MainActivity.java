package dev.rapina.herdrpocket;

import android.app.Activity;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Build;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.view.View;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView web;
    private ConnectionStore connection;
    private FrameLayout frame;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String permissionCall;
    private String pendingNotification;
    private final ExecutorService workers = Executors.newFixedThreadPool(4);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        connection = ConnectionStore.get(this);
        pendingNotification = notificationKey(getIntent());
        getWindow().setStatusBarColor(Color.rgb(32, 25, 37));
        getWindow().setNavigationBarColor(Color.rgb(32, 25, 37));
        frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(32, 25, 37));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(32, 25, 37));
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
                v.setPadding(bars.left, bars.top, bars.right, bottom);
                return insets;
            });
        }
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return MediaProxy.intercept(connection, request); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view; fullscreenCallback = callback;
                frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
                web.setVisibility(View.GONE);
                getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
        });
        web.addJavascriptInterface(new Bridge(), "PocketNative");
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override protected void onResume() {
        super.onResume();
        PushManager.foreground(this, true);
        if (web != null) web.onResume();
        if (web != null) web.evaluateJavascript("window.pocketPushRefresh && window.pocketPushRefresh()", null);
    }
    @Override protected void onPause() {
        PushManager.foreground(this, false);
        if (web != null) web.evaluateJavascript("window.pauseMedia && window.pauseMedia()", null);
        if (web != null) web.onPause();
        super.onPause();
    }

    private String notificationKey(Intent intent) {
        String key = intent == null ? null : intent.getStringExtra("notificationKey");
        return key != null && key.matches("[a-f0-9-]{36}") ? key : null;
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        synchronized (this) { pendingNotification = notificationKey(intent); }
        if (web != null) web.evaluateJavascript("window.pocketOpenNotification && window.pocketOpenNotification()", null);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 7031 && permissionCall != null) {
            String id = permissionCall;
            permissionCall = null;
            dispatchCall(id, "push", "{\"enabled\":true}");
        }
    }
    @Override public void onBackPressed() {
        if (fullscreen != null) { hideFullscreen(); return; }
        web.evaluateJavascript("window.pocketBack && window.pocketBack()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }
    private void hideFullscreen() {
        if (fullscreen == null) return;
        frame.removeView(fullscreen); fullscreen = null;
        web.setVisibility(View.VISIBLE);
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback; fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }
    @Override protected void onDestroy() {
        workers.shutdownNow();
        if (web != null) { web.removeJavascriptInterface("PocketNative"); web.destroy(); }
        super.onDestroy();
    }

    private class Bridge {
        @JavascriptInterface public void haptic(String kind) {
            runOnUiThread(() -> {
                if (isDestroyed() || !web.hasWindowFocus()) return;
                int feedback = android.view.HapticFeedbackConstants.VIRTUAL_KEY;
                if (Build.VERSION.SDK_INT >= 30) {
                    if ("success".equals(kind)) feedback = android.view.HapticFeedbackConstants.CONFIRM;
                    else if ("reject".equals(kind)) feedback = android.view.HapticFeedbackConstants.REJECT;
                }
                web.performHapticFeedback(feedback);
            });
        }
        @JavascriptInterface public void call(String id, String method, String payload) {
            if (!id.matches("[0-9]+")) return;
            if (method.equals("openLink")) {
                runOnUiThread(() -> openLink(id, payload));
                return;
            }
            if (method.equals("push")) {
                try {
                    if (new JSONObject(payload).optBoolean("enabled") && Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> {
                            if (permissionCall != null) { dispatchCall(id, method, payload); return; }
                            permissionCall = id;
                            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7031);
                        });
                        return;
                    }
                } catch (Exception ignored) { }
            }
            dispatchCall(id, method, payload);
        }
    }
    private void openLink(String id, String payload) {
        JSONObject envelope = new JSONObject();
        try {
            String target = new JSONObject(payload).getString("url");
            java.net.URI uri = new java.net.URI(target);
            String scheme = uri.getScheme();
            if (target.length() > 4096 || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                || uri.getHost() == null || uri.getRawUserInfo() != null || "pocket-media.invalid".equalsIgnoreCase(uri.getHost()))
                throw new IllegalArgumentException("unsupported link");
            Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(target));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
            envelope.put("ok", true).put("data", new JSONObject().put("opened", true));
        } catch (Exception e) {
            try { envelope.put("ok", false).put("error", "link_open_failed"); } catch (Exception ignored) { }
        }
        if (!isDestroyed()) web.evaluateJavascript("window.pocketReply(" + JSONObject.quote(id) + "," + envelope + ")", null);
    }
    private void dispatchCall(String id, String method, String payload) {
            workers.execute(() -> {
                JSONObject envelope = new JSONObject();
                try {
                    JSONObject data = new JSONObject(payload);
                    JSONObject result;
                    switch (method) {
                        case "copy":
                            String text = data.getString("text");
                            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            if (clipboard == null) throw new Exception("copy_failed");
                            clipboard.setPrimaryClip(ClipData.newPlainText("Wired", text));
                            result = new JSONObject().put("copied", true);
                            break;
                        case "settings": result = connection.settings().put("push", PushManager.status(MainActivity.this)); break;
                        case "configure":
                            if (!data.optString("url").replaceAll("/+$", "").equals(connection.settings().optString("url"))) PushManager.disable(MainActivity.this);
                            result = connection.configure(data); break;
                        case "request": result = connection.request(data); break;
                        case "forget": PushManager.disable(MainActivity.this); connection.forget(); result = connection.settings(); break;
                        case "pushStatus": result = PushManager.status(MainActivity.this); break;
                        case "pushSettings":
                            runOnUiThread(() -> startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())));
                            result = new JSONObject(); break;
                        case "push": result = data.optBoolean("enabled") ? PushManager.enable(MainActivity.this) : PushManager.disable(MainActivity.this); break;
                        case "pushContext": PushManager.context(MainActivity.this, data); result = new JSONObject(); break;
                        case "notificationIntent":
                            synchronized (MainActivity.this) { result = new JSONObject().put("key", pendingNotification == null ? JSONObject.NULL : pendingNotification); }
                            break;
                        case "notificationHandled":
                            synchronized (MainActivity.this) {
                                if (data.optString("key").equals(pendingNotification)) { pendingNotification = null; getIntent().removeExtra("notificationKey"); }
                                result = new JSONObject();
                            }
                            break;
                        default: throw new Exception("unsupported_request");
                    }
                    envelope.put("ok", true).put("data", result);
                } catch (Exception e) {
                    try {
                        String message = e.getMessage();
                        if (e instanceof java.io.IOException) message = "network_error";
                        envelope.put("ok", false).put("error", message == null ? "request_failed" : message).put("status", e instanceof ConnectionStore.HttpFailure ? ((ConnectionStore.HttpFailure)e).status : 0);
                    } catch (Exception ignored) { }
                }
                final String script = "window.pocketReply(" + JSONObject.quote(id) + "," + envelope + ")";
                runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript(script, null); });
            });
    }
}

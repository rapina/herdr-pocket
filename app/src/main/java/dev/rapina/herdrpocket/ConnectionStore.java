package dev.rapina.herdrpocket;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class ConnectionStore {
    static class HttpFailure extends Exception {
        final int status;
        HttpFailure(String code, int status) { super(code); this.status = status; }
    }
    private static ConnectionStore instance;
    static synchronized ConnectionStore get(Context context) {
        if (instance == null) instance = new ConnectionStore(context.getApplicationContext());
        return instance;
    }
    private final SharedPreferences prefs;
    private static final String KEY = "herdr-pocket-connection";
    private ConnectionStore(Context context) { prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE); }
    synchronized void forget() { prefs.edit().clear().commit(); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(KEY, null)).getSecretKey();
    }
    private String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key());
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(c.doFinal(plain.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
    private String decrypt(String value) throws Exception {
        String[] parts = value.split("\\.");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    synchronized JSONObject settings() throws Exception {
        return new JSONObject().put("url", prefs.getString("url", "")).put("configured", prefs.contains("token"));
    }
    synchronized JSONObject configure(JSONObject data) throws Exception {
        String url = BridgeUrl.parse(data.getString("url"));
        String token = data.optString("token", "").trim();
        SharedPreferences.Editor edit = prefs.edit();
        if (token.isEmpty()) {
            if (!url.equals(prefs.getString("url", "")) || !prefs.contains("token")) throw new Exception("key_required");
        } else {
            if (!token.matches("[a-fA-F0-9]{64}")) throw new Exception("invalid_key");
            edit.putString("token", encrypt(token));
        }
        if (!edit.putString("url", url).commit()) throw new Exception("save_failed");
        return settings();
    }
    synchronized HttpsURLConnection openMedia(String id) throws Exception {
        if (!id.matches("[a-f0-9]{64}") || !prefs.contains("token")) throw new Exception("media_expired");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(prefs.getString("url", "") + "/v1/media?id=" + id).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(100000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Authorization", "Bearer " + decrypt(prefs.getString("token", "")));
        return connection;
    }
    JSONObject request(JSONObject data) throws Exception {
        String base, token;
        synchronized (this) {
            base = prefs.getString("url", "");
            if (!prefs.contains("token")) throw new Exception("configure_first");
            token = decrypt(prefs.getString("token", ""));
        }
        String path = data.getString("path");
        if (!path.matches("/v1/(snapshot|terminal|message|receipt|push/(?:options|device|remove|resolve))(\\?[^#\\r\\n]*)?")) throw new Exception("unsupported_request");
        String method = data.optString("method", "GET");
        if (!method.equals("GET") && !method.equals("POST")) throw new Exception("unsupported_request");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(22000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (method.equals("POST")) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = data.getJSONObject("body").toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = "{}";
            if (stream != null) try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > 2 * 1024 * 1024) throw new Exception("response_large"); }
                text = out.toString("UTF-8");
            }
            JSONObject result;
            try { result = new JSONObject(text); } catch (Exception e) { throw new Exception("invalid_response"); }
            if (status < 200 || status >= 300) throw new HttpFailure(result.optString("error", "request_failed"), status);
            return result;
        } finally { connection.disconnect(); }
    }
}

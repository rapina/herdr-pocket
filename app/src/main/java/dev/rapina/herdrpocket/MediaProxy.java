package dev.rapina.herdrpocket;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;

/** Streams authenticated media into the local WebView without exposing credentials to JS. */
final class MediaProxy {
    static WebResourceResponse intercept(ConnectionStore store, WebResourceRequest request) {
        String scheme = request.getUrl().getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        if (!"https".equals(scheme) || !"pocket-media.invalid".equals(request.getUrl().getHost())
            || request.getUrl().getPort() != -1 || request.getUrl().getQuery() != null
            || !request.getUrl().getPath().matches("/[a-f0-9]{64}")
            || !"GET".equals(request.getMethod())) return error(403);
        HttpsURLConnection connection = null;
        try {
            connection = store.openMedia(request.getUrl().getLastPathSegment());
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                if ("Range".equalsIgnoreCase(header.getKey()) && header.getValue().matches("bytes=[0-9]*-[0-9]*"))
                    connection.setRequestProperty("Range", header.getValue());
            }
            int status = connection.getResponseCode();
            String mime = connection.getContentType();
            if ((status != 200 && status != 206) || mime == null || !mime.matches("(image|audio|video)/[a-z0-9.+-]+")) {
                connection.disconnect(); return error(status >= 400 ? status : 502);
            }
            Map<String, String> headers = new HashMap<>();
            for (String name : new String[]{"Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "X-Content-Type-Options"}) {
                String value = connection.getHeaderField(name);
                if (value != null) headers.put(name, value);
            }
            final HttpsURLConnection opened = connection;
            InputStream stream = new FilterInputStream(connection.getInputStream()) {
                @Override public void close() throws IOException { try { super.close(); } finally { opened.disconnect(); } }
            };
            return new WebResourceResponse(mime, null, status, status == 206 ? "Partial Content" : "OK", headers, stream);
        } catch (Exception error) {
            if (connection != null) connection.disconnect();
            return error(502);
        }
    }
    private static WebResourceResponse error(int status) {
        return new WebResourceResponse("text/plain", "UTF-8", status, "Unavailable", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}

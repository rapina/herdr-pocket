package dev.rapina.herdrpocket;

import java.net.URI;
import java.net.URISyntaxException;

final class BridgeUrl {
    private BridgeUrl() {}

    static String parse(String input) throws Exception {
        if (input == null) throw new Exception("invalid_url");
        String url = input.trim().replaceAll("/+$", "");
        try {
            URI uri = new URI(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                || uri.getPort() == 0 || uri.getPort() > 65535
                || uri.getRawAuthority().endsWith(":")) throw new Exception("invalid_url");
            return "https" + url.substring(uri.getScheme().length());
        } catch (URISyntaxException e) {
            throw new Exception("invalid_url");
        }
    }
}

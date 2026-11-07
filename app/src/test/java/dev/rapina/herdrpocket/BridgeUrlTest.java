package dev.rapina.herdrpocket;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class BridgeUrlTest {
    @Test public void acceptsHttpsOriginsAcrossNetworks() throws Exception {
        String[] origins = {
            "https://bridge.example.com", "https://bridge.example.com:9443",
            "https://my-pc.example.ts.net:9443", "https://192.168.1.10:443",
            "https://[2001:db8::1]:9443", "https://bridge.internal", "https://localhost"
        };
        for (String origin : origins) assertEquals(origin, BridgeUrl.parse(origin));
    }

    @Test public void trimsInputAndNormalizesScheme() throws Exception {
        assertEquals("https://bridge.example.com:9443",
            BridgeUrl.parse("  HTTPS://bridge.example.com:9443///  "));
    }

    @Test public void rejectsNonOriginsAndMalformedAddresses() {
        String[] invalid = {
            null, "", "bridge.example.com", "http://bridge.example.com", "file:///tmp/bridge",
            "https://", "https:///bridge.example.com", "https://user:pass@bridge.example.com",
            "https://bridge.example.com/path", "https://bridge.example.com/%2f",
            "https://bridge.example.com?token=secret", "https://bridge.example.com#fragment",
            "https://bridge.example.com:0", "https://bridge.example.com:65536",
            "https://bridge.example.com:-1", "https://bridge.example.com:",
            "https://bridge.example.com:abc", "https://bad host", "https://[broken",
            "https://bridge.example.com\\@other.example.com"
        };
        for (String input : invalid) {
            Exception error = assertThrows("Accepted: " + input, Exception.class, () -> BridgeUrl.parse(input));
            assertEquals("invalid_url", error.getMessage());
        }
    }
}

package dev.rapina.herdrpocket;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class PocketMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message) { PushManager.show(this, message.getData()); }
    @Override public void onNewToken(String token) { PushManager.scheduleRegistration(this); }
}

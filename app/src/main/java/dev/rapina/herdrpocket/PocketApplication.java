package dev.rapina.herdrpocket;

import android.app.Application;

public class PocketApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        PushManager.initialize(this);
    }
}

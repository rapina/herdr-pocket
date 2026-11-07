package dev.rapina.herdrpocket;

import android.app.job.JobService;
import android.app.job.JobParameters;

public class PushRegistrationJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        PushManager.work.execute(() -> {
            boolean retry = false;
            try { PushManager.register(this); } catch (Exception e) { retry = true; }
            jobFinished(params, retry);
        });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}

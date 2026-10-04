package com.notmtn.planner;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String UPDATE_PREFERENCES = "planner-updater";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlannerUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        reopenAfterSuccessfulUpdate();
    }

    /**
     * PackageInstaller returns to its caller after the user confirms. Android
     * may have restarted this process as part of replacing the APK; compare
     * the installed version before clearing the one-shot hand-off marker, then
     * start Planner from the freshly installed package.
     */
    private void reopenAfterSuccessfulUpdate() {
        SharedPreferences preferences = getSharedPreferences(UPDATE_PREFERENCES, MODE_PRIVATE);
        long expectedCode = preferences.getLong("pendingVersionCode", 0L);
        String expectedName = preferences.getString("pendingVersionName", "");
        if (expectedCode <= 0L) return;

        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            if (installedCode < expectedCode || !expectedName.equals(info.versionName)) {
                // Returning from the installer without this version means the
                // person cancelled; keep the existing app and its data intact.
                preferences.edit().remove("pendingVersionCode").remove("pendingVersionName").apply();
                return;
            }

            preferences.edit().remove("pendingVersionCode").remove("pendingVersionName").apply();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            new Handler(Looper.getMainLooper()).postDelayed(() -> startActivity(launch), 250L);
        } catch (Exception ignored) {
            // A package lookup failure must not interfere with a normal boot.
        }
    }
}

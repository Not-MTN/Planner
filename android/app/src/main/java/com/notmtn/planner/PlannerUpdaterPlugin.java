package com.notmtn.planner;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PlannerUpdater")
public class PlannerUpdaterPlugin extends Plugin {
    private static final String TAG = "PlannerUpdater";
    private static final String PACKAGE_ID = "com.notmtn.planner";
    private static final String MANIFEST_URL = "https://github.com/Not-MTN/Planner/releases/latest/download/planner-update.json";
    private static final String APK_FILE_NAME = "app-release.apk";
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;
    private static final String PREFERENCES = "planner-updater";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean downloadInProgress = false;
    private volatile boolean installInProgress = false;

    @PluginMethod
    public void getInstallInfo(PluginCall call) {
        try {
            call.resolve(installedInfo());
        } catch (Exception error) {
            call.reject("Could not read the installed Planner package information.", error);
        }
    }

    @PluginMethod
    public void getUpdateManifest(PluginCall call) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = openTrustedConnection(MANIFEST_URL, 15_000, 20_000);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("The update feed returned HTTP " + status + ".");
                long declaredLength = connection.getContentLengthLong();
                if (declaredLength > 128 * 1024) throw new IllegalStateException("The update feed is unexpectedly large.");
                String manifest = readBounded(connection.getInputStream(), 128 * 1024);
                JSObject result = new JSObject();
                result.put("manifest", manifest);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The update feed could not be checked.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        if (downloadInProgress) {
            call.reject("An update download is already in progress.");
            return;
        }
        final UpdateRequest request;
        try {
            request = UpdateRequest.from(call);
            verifyInstalledIdentity(request);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
            return;
        }
        downloadInProgress = true;
        executor.execute(() -> {
            HttpURLConnection connection = null;
            File partial = null;
            try {
                File directory = new File(getContext().getCacheDir(), "planner-updates");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Could not prepare secure update storage.");
                File apk = new File(directory, "planner-" + request.versionCode + ".apk");
                partial = new File(directory, "planner-" + request.versionCode + ".apk.part");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("Could not remove an incomplete update download.");

                connection = openTrustedConnection(request.downloadUrl, 20_000, 60_000);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("The APK download returned HTTP " + status + ".");
                long declaredLength = connection.getContentLengthLong();
                if (declaredLength > 0 && declaredLength != request.sizeBytes) throw new IllegalStateException("The APK size does not match the release manifest.");

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0;
                long lastProgressAt = 0;
                byte[] buffer = new byte[32 * 1024];
                try (InputStream input = new BufferedInputStream(connection.getInputStream());
                     BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(partial))) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        received += count;
                        if (received > request.sizeBytes || received > MAX_APK_BYTES) {
                            throw new IllegalStateException("The APK is larger than the release manifest allows.");
                        }
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                        long now = System.currentTimeMillis();
                        if (now - lastProgressAt > 150 || received == request.sizeBytes) {
                            lastProgressAt = now;
                            notifyDownloadProgress(received, request.sizeBytes);
                        }
                    }
                }
                if (received != request.sizeBytes) throw new IllegalStateException("The APK download ended before the expected size.");
                if (!hex(digest.digest()).equals(request.sha256)) throw new IllegalStateException("The APK checksum does not match the release manifest.");
                verifyApk(partial, request);
                if (apk.exists() && !apk.delete()) throw new IllegalStateException("Could not replace a previously downloaded update.");
                if (!partial.renameTo(apk)) throw new IllegalStateException("Could not finalize the verified APK.");

                JSObject result = new JSObject();
                result.put("ready", true);
                call.resolve(result);
            } catch (Exception error) {
                if (partial != null && partial.exists()) partial.delete();
                call.reject(error.getMessage() == null ? "The update download failed." : error.getMessage(), error);
            } finally {
                downloadInProgress = false;
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (installInProgress) {
            call.reject("The Android installer is already open.");
            return;
        }
        installInProgress = true;
        // APK hashing and package-archive inspection can take several seconds
        // on a phone. Do them off the WebView thread so the update tap cannot
        // appear to freeze before Android's install confirmation opens.
        executor.execute(() -> {
            final UpdateRequest request;
            final File apk;
            try {
                request = UpdateRequest.from(call);
                verifyInstalledIdentity(request);
                apk = downloadedApk(request);
                verifyDownloadedApk(apk, request);
            } catch (Exception error) {
                installInProgress = false;
                call.reject(error.getMessage() == null ? "Could not prepare the verified Android update." : error.getMessage(), error);
                return;
            }

            Activity activity = getActivity();
            if (activity == null) {
                installInProgress = false;
                call.reject("Keep Planner open while the Android update is prepared.");
                return;
            }
            activity.runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                    try {
                        startActivityForResult(call, settings, "unknownSourcesSettingsResult");
                    } catch (Exception error) {
                        installInProgress = false;
                        call.reject("Could not open Android's install-permission settings.", error);
                    }
                    return;
                }
                startSystemInstaller(call, request, apk);
            });
        });
    }

    @ActivityCallback
    private void unknownSourcesSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            installInProgress = false;
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            installInProgress = false;
            call.reject("Allow Planner to install the downloaded update in Android settings, then try again.");
            return;
        }

        // The user may have left Planner in Settings for a while. Recheck the
        // private APK and installed package identity before opening the system
        // installer, and keep the expensive verification away from the UI.
        executor.execute(() -> {
            final UpdateRequest request;
            final File apk;
            try {
                request = UpdateRequest.from(call);
                verifyInstalledIdentity(request);
                apk = downloadedApk(request);
                verifyDownloadedApk(apk, request);
            } catch (Exception error) {
                installInProgress = false;
                call.reject(error.getMessage() == null ? "Could not prepare the verified Android update." : error.getMessage(), error);
                return;
            }
            Activity activity = getActivity();
            if (activity == null) {
                installInProgress = false;
                call.reject("Keep Planner open while the Android update is prepared.");
                return;
            }
            activity.runOnUiThread(() -> startSystemInstaller(call, request, apk));
        });
    }

    @ActivityCallback
    private void installerActivityResult(PluginCall call, ActivityResult result) {
        installInProgress = false;
        if (call == null) return;
        try {
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(PACKAGE_ID, 0);
            long code = versionCode(installed);
            UpdateRequest requested = UpdateRequest.from(call);
            if (code < requested.versionCode || !requested.version.equals(installed.versionName)) {
                clearPendingRelaunch();
                call.reject("The installation was cancelled or did not finish.");
                return;
            }
            JSObject response = new JSObject();
            response.put("installed", true);
            response.put("versionCode", code);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not confirm the installed update.", error);
        }
    }

    private void verifyDownloadedApk(File apk, UpdateRequest request) throws Exception {
        if (!apk.isFile() || apk.length() != request.sizeBytes || !sha256File(apk).equals(request.sha256)) {
            throw new IllegalStateException("Download and verify the APK before installing it.");
        }
        verifyApk(apk, request);
    }

    private void startSystemInstaller(PluginCall call, UpdateRequest request, File apk) {
        try {
            if (!apk.isFile()) throw new IllegalStateException("The verified APK is no longer available.");
            SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE);
            preferences.edit()
                .putLong("pendingVersionCode", request.versionCode)
                .putString("pendingVersionName", request.version)
                .apply();

            Uri contentUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            startActivityForResult(call, installIntent, "installerActivityResult");
        } catch (Exception error) {
            installInProgress = false;
            clearPendingRelaunch();
            call.reject(error.getMessage() == null ? "Could not open the Android installer." : error.getMessage(), error);
        }
    }

    private void verifyInstalledIdentity(UpdateRequest request) throws Exception {
        JSObject installed = installedInfo();
        String installer = installed.getString("installerPackageName", "");
        if ("com.android.vending".equals(installer)) {
            throw new IllegalStateException("Google Play manages updates for this installation.");
        }
        String currentSigner = normalizeFingerprint(installed.getString("signingCertificateSha256", ""));
        if (currentSigner.isEmpty() || !currentSigner.equals(request.signingCertificateSha256)) {
            throw new IllegalStateException("The update signing key does not match this installed app. It was not installed to protect your planner data.");
        }
        PackageInfo installedPackage = getContext().getPackageManager().getPackageInfo(PACKAGE_ID, 0);
        if (request.versionCode <= versionCode(installedPackage)) {
            throw new IllegalStateException("This update is not newer than the installed Planner version.");
        }
    }

    private void verifyApk(File apk, UpdateRequest request) throws Exception {
        PackageManager packageManager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null || archive.applicationInfo == null) throw new IllegalStateException("The downloaded file is not a valid Android package.");
        if (!PACKAGE_ID.equals(archive.packageName) || !PACKAGE_ID.equals(request.applicationId)) {
            throw new IllegalStateException("The APK package name does not match Planner.");
        }
        if (!request.version.equals(archive.versionName) || versionCode(archive) != request.versionCode) {
            throw new IllegalStateException("The APK version does not match the release manifest.");
        }
        String signer = signatureFingerprint(archive);
        if (signer.isEmpty() || !signer.equals(request.signingCertificateSha256)) {
            throw new IllegalStateException("The APK signing key does not match this installation. The update was blocked to protect planner data.");
        }
    }

    private JSObject installedInfo() throws Exception {
        PackageManager packageManager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo info = packageManager.getPackageInfo(PACKAGE_ID, flags);
        JSObject result = new JSObject();
        result.put("applicationId", info.packageName);
        result.put("versionName", info.versionName == null ? "" : info.versionName);
        result.put("versionCode", versionCode(info));
        result.put("signingCertificateSha256", signatureFingerprint(info));
        result.put("installerPackageName", installerPackageName(packageManager));
        return result;
    }

    private String installerPackageName(PackageManager packageManager) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                InstallSourceInfo source = packageManager.getInstallSourceInfo(PACKAGE_ID);
                return source.getInstallingPackageName() == null ? "" : source.getInstallingPackageName();
            }
            String installer = packageManager.getInstallerPackageName(PACKAGE_ID);
            return installer == null ? "" : installer;
        } catch (Exception ignored) {
            return "";
        }
    }

    private String signatureFingerprint(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length != 1) return "";
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return hex(digest.digest(signatures[0].toByteArray()));
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private File downloadedApk(UpdateRequest request) {
        return new File(new File(getContext().getCacheDir(), "planner-updates"), "planner-" + request.versionCode + ".apk");
    }

    private void notifyDownloadProgress(long received, long total) {
        Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            JSObject progress = new JSObject();
            progress.put("bytesReceived", received);
            progress.put("totalBytes", total);
            notifyListeners("downloadProgress", progress);
        });
    }

    private HttpURLConnection openTrustedConnection(String value, int connectTimeout, int readTimeout) throws Exception {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !"github.com".equalsIgnoreCase(url.getHost())) {
            throw new IllegalArgumentException("The update service must use the official HTTPS release host.");
        }
        if (!value.startsWith("https://github.com/Not-MTN/Planner/releases/")) {
            throw new IllegalArgumentException("The update URL is outside Planner’s official releases.");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(connectTimeout);
        connection.setReadTimeout(readTimeout);
        connection.setRequestMethod("GET");
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("Accept", "application/json, application/octet-stream");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", "Planner-Android-Updater");
        connection.connect();
        URL finalUrl = connection.getURL();
        String host = finalUrl.getHost().toLowerCase(Locale.ROOT);
        boolean trustedHost = "github.com".equals(host)
            || "release-assets.githubusercontent.com".equals(host)
            || "objects.githubusercontent.com".equals(host);
        if (!"https".equalsIgnoreCase(finalUrl.getProtocol()) || !trustedHost) {
            connection.disconnect();
            throw new IllegalArgumentException("The update redirected to an untrusted host.");
        }
        return connection;
    }

    private static String readBounded(InputStream input, int limit) throws Exception {
        try (InputStream in = new BufferedInputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (output.size() + read > limit) throw new IllegalStateException("The update feed is larger than expected.");
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private void clearPendingRelaunch() {
        getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE).edit()
            .remove("pendingVersionCode")
            .remove("pendingVersionName")
            .apply();
    }

    private static String normalizeFingerprint(String value) {
        return value == null ? "" : value.replaceAll("[:\\s]", "").toLowerCase(Locale.ROOT);
    }

    private static long integralNumber(Object value) {
        if (!(value instanceof Number)) return -1L;
        Number number = (Number) value;
        long result = number.longValue();
        return number.doubleValue() == (double) result ? result : -1L;
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static final class UpdateRequest {
        final String applicationId;
        final String version;
        final long versionCode;
        final String signingCertificateSha256;
        final String fileName;
        final String downloadUrl;
        final long sizeBytes;
        final String sha256;

        private UpdateRequest(String applicationId, String version, long versionCode, String signer, String fileName, String url, long sizeBytes, String sha256) {
            this.applicationId = applicationId;
            this.version = version;
            this.versionCode = versionCode;
            this.signingCertificateSha256 = signer;
            this.fileName = fileName;
            this.downloadUrl = url;
            this.sizeBytes = sizeBytes;
            this.sha256 = sha256;
        }

        static UpdateRequest from(PluginCall call) throws Exception {
            String applicationId = call.getString("applicationId", "");
            String version = call.getString("version", "");
            long versionCode = integralNumber(call.getData().opt("versionCode"));
            String signer = normalizeFingerprint(call.getString("signingCertificateSha256", ""));
            String fileName = call.getString("fileName", "");
            String url = call.getString("downloadUrl", "");
            long size = integralNumber(call.getData().opt("sizeBytes"));
            String sha256 = call.getString("sha256", "").toLowerCase(Locale.ROOT);

            if (!PACKAGE_ID.equals(applicationId) || !"app-release.apk".equals(fileName)) throw new IllegalArgumentException("The update does not belong to Planner.");
            if (!version.matches("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$")) throw new IllegalArgumentException("The update version is invalid.");
            if (versionCode < 1 || versionCode > 2_100_000_000L || size < 1 || size > MAX_APK_BYTES) throw new IllegalArgumentException("The update size or Android versionCode is invalid.");
            if (!signer.matches("[a-f0-9]{64}") || !sha256.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("The update checksum or signing identity is invalid.");
            String expectedUrl = "https://github.com/Not-MTN/Planner/releases/download/v" + version + "/app-release.apk";
            if (!expectedUrl.equals(url)) throw new IllegalArgumentException("The APK URL is outside the official stable release.");
            return new UpdateRequest(applicationId, version, versionCode, signer, fileName, url, size, sha256);
        }
    }
}

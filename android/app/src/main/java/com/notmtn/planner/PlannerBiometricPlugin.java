package com.notmtn.planner;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import android.util.Log;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The Android half of "unlock with your fingerprint or face" (docs/APPS.md §9).
 *
 * The vault key never leaves the platform's own protected storage: this plugin
 * generates an AES key inside the Android Keystore that is marked
 * {@code setUserAuthenticationRequired(true)}, so a cipher operation on it can
 * only succeed with a fresh biometric authentication attached. The vault key
 * itself is then stored as ciphertext in the app's private preferences — the
 * Keystore key is what protects it, and the phone's enrolled fingerprint or
 * face is what unlocks that key.
 *
 * Three rules, matching src/auth/biometric.ts:
 *
 *   1. {@code isAvailable} only asks the platform whether it could do this. It
 *      never prompts and never throws.
 *   2. A key the OS has thrown away — because the enrolled fingerprints or face
 *      changed — is reported as {@code invalidated}, wiped, and never retried
 *      silently. That is a different sentence on screen from a cancelled prompt.
 *   3. Nothing here is a substitute for the password: it is an extra way in,
 *      stored on this device only, and {@code forget} removes it completely.
 */
@CapacitorPlugin(name = "PlannerBiometric")
public class PlannerBiometricPlugin extends Plugin {
    private static final String TAG = "PlannerBiometric";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "planner-biometric-v1";
    private static final String PREFERENCES = "planner-biometric";
    private static final String PREF_PAYLOAD = "payload";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /** Whether the hardware is there and somebody is enrolled. Silent, as promised. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            int status = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
            result.put("kind", hardwareKind());
        } catch (Exception error) {
            // A platform that cannot answer is a platform that cannot do this.
            result.put("available", false);
            result.put("kind", "biometrics");
        }
        call.resolve(result);
    }

    /** Whether a key for this account is already stored. Also silent. */
    @PluginMethod
    public void hasKey(PluginCall call) {
        executor.execute(() -> {
            boolean present = false;
            try {
                present = prefs().contains(PREF_PAYLOAD) && usableKey() != null;
            } catch (Exception error) {
                Log.w(TAG, "Could not read the stored biometric key", error);
            }
            JSObject result = new JSObject();
            result.put("present", present);
            call.resolve(result);
        });
    }

    /**
     * Stores the vault key behind the biometric check. The key is only written
     * after the person passes the check, so an unattended phone cannot be made
     * to hand it over by the app alone.
     */
    @PluginMethod
    public void save(final PluginCall call) {
        final String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("There was no key to save.", "failed");
            return;
        }
        final String reason = reasonOf(call);
        final byte[] plain = value.getBytes(StandardCharsets.UTF_8);
        executor.execute(() -> {
            final Cipher cipher;
            try {
                cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.ENCRYPT_MODE, keyForWriting());
            } catch (Exception error) {
                fail(call, error);
                return;
            }
            authenticate(cipher, reason, call, new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    executor.execute(() -> {
                        try {
                            Cipher unlocked = result.getCryptoObject() == null ? cipher : result.getCryptoObject().getCipher();
                            byte[] iv = unlocked.getIV();
                            byte[] sealed = unlocked.doFinal(plain);
                            prefs().edit()
                                .putString(PREF_PAYLOAD,
                                    Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP))
                                .apply();
                            call.resolve();
                        } catch (Exception error) {
                            fail(call, error);
                        }
                    });
                }

                @Override
                public void onAuthenticationError(int code, CharSequence message) {
                    call.reject(message == null ? "Unlock cancelled." : message.toString(), errorCode(code));
                }

                @Override
                public void onAuthenticationFailed() {
                    // A finger that did not match; the prompt stays open and the
                    // person can try again. Not a failure of the call.
                }
            });
        });
    }

    /** Reads the vault key back, which is what makes the phone ask for a face or a finger. */
    @PluginMethod
    public void read(final PluginCall call) {
        final String reason = reasonOf(call);
        executor.execute(() -> {
            String payload = prefs().getString(PREF_PAYLOAD, null);
            String[] parts = payload == null ? new String[0] : payload.split(":", 2);
            if (parts.length != 2) {
                call.reject("The saved unlock is no longer on this device.", "invalidated");
                return;
            }
            final Cipher cipher;
            try {
                SecretKey key = usableKey();
                if (key == null) throw new KeyPermanentlyInvalidatedException();
                cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(parts[0], Base64.NO_WRAP)));
            } catch (Exception error) {
                fail(call, error);
                return;
            }
            final byte[] sealed = Base64.decode(parts[1], Base64.NO_WRAP);
            authenticate(cipher, reason, call, new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    executor.execute(() -> {
                        try {
                            Cipher unlocked = result.getCryptoObject() == null ? cipher : result.getCryptoObject().getCipher();
                            JSObject answer = new JSObject();
                            answer.put("value", new String(unlocked.doFinal(sealed), StandardCharsets.UTF_8));
                            call.resolve(answer);
                        } catch (Exception error) {
                            fail(call, error);
                        }
                    });
                }

                @Override
                public void onAuthenticationError(int code, CharSequence message) {
                    call.reject(message == null ? "Unlock cancelled." : message.toString(), errorCode(code));
                }
            });
        });
    }

    /** Drops the stored key and the Keystore key that protects it. */
    @PluginMethod
    public void forget(PluginCall call) {
        executor.execute(() -> {
            try {
                KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            } catch (Exception error) {
                Log.w(TAG, "Could not remove the biometric Keystore key", error);
            }
            prefs().edit().remove(PREF_PAYLOAD).apply();
            call.resolve();
        });
    }

    /**
     * Shows the platform's own prompt for a cipher operation. Must run on the
     * main thread: the prompt is tied to the activity that is on screen.
     */
    private void authenticate(final Cipher cipher, final String reason, final PluginCall call,
                              final BiometricPrompt.AuthenticationCallback callback) {
        final FragmentActivity activity;
        try {
            activity = (FragmentActivity) getActivity();
        } catch (ClassCastException error) {
            call.reject("Planner is not showing a screen that can ask for your fingerprint.", "unavailable");
            return;
        }
        if (activity == null) {
            call.reject("Keep Planner open while you unlock it.", "unavailable");
            return;
        }
        final AtomicBoolean settled = new AtomicBoolean(false);
        activity.runOnUiThread(() -> {
            if (settled.get()) return;
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        settled.set(true);
                        callback.onAuthenticationSucceeded(result);
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        settled.set(true);
                        callback.onAuthenticationError(code, message);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        callback.onAuthenticationFailed();
                    }
                });
            try {
                prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(reason)
                    .setNegativeButtonText(getContext().getString(R.string.biometric_use_password))
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build(), new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception error) {
                settled.set(true);
                call.reject("This device cannot ask for your fingerprint right now.", "unavailable");
            }
        });
    }

    /**
     * The Keystore key, or null when it is gone or the OS has thrown it away.
     * Initializing a cipher is the cheapest way to ask that question without
     * prompting anybody.
     */
    private SecretKey usableKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) return null;
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key == null) return null;
        try {
            Cipher probe = Cipher.getInstance(TRANSFORMATION);
            probe.init(Cipher.ENCRYPT_MODE, key);
        } catch (KeyPermanentlyInvalidatedException gone) {
            return null;
        }
        return key;
    }

    /** The key to write with, replacing one the OS has invalidated. */
    private SecretKey keyForWriting() throws Exception {
        SecretKey existing = usableKey();
        if (existing != null) return existing;
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        // Enrolling a new fingerprint deletes the old key's usefulness; the
        // ciphertext it protected is unusable too, so both go together.
        if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
        prefs().edit().remove(PREF_PAYLOAD).apply();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            // One face or finger per use, and a change to the enrolled
            // biometrics retires the key rather than reopening it for whoever
            // enrolled the new one.
            .setInvalidatedByBiometricEnrollment(true)
            .build());
        generator.generateKey();
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String reasonOf(PluginCall call) {
        String reason = call.getString("reason");
        return reason == null || reason.isEmpty() ? "Unlock your planner" : reason;
    }

    /** What to call the check on screen; only used for the settings row and the button. */
    private String hardwareKind() {
        PackageManager manager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && manager.hasSystemFeature(PackageManager.FEATURE_FACE)) return "face";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && manager.hasSystemFeature(PackageManager.FEATURE_IRIS)) return "iris";
        if (manager.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) return "fingerprint";
        return "biometrics";
    }

    /**
     * Turns Android's prompt result into the small vocabulary src/auth/biometric.ts
     * understands, so the screen can tell "they changed their mind" from
     * "this device cannot do it" from "the fingerprints changed".
     */
    private static String errorCode(int code) {
        switch (code) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "cancelled";
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
            case BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED:
            case BiometricPrompt.ERROR_UNABLE_TO_PROCESS:
                return "unavailable";
            default:
                return "failed";
        }
    }

    private void fail(PluginCall call, Exception error) {
        if (error instanceof KeyPermanentlyInvalidatedException) {
            // The OS has already retired the key; drop the unusable ciphertext
            // with it and let the screen say so in its own words.
            prefs().edit().remove(PREF_PAYLOAD).apply();
            call.reject("The saved unlock was removed when the biometrics on this device changed.", "invalidated");
            return;
        }
        if (error instanceof UserNotAuthenticatedException) {
            call.reject("Unlock with your fingerprint or face to continue.", "unavailable");
            return;
        }
        Log.w(TAG, "Biometric unlock failed", error);
        call.reject("That did not unlock your planner.", "failed");
    }
}

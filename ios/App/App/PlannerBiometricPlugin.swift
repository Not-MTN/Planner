import Foundation
import Capacitor
import LocalAuthentication
import Security

/**
 The iOS half of "unlock with your face or finger" (docs/APPS.md §9).

 The vault key is stored in the Keychain as a generic password whose access
 control is `.biometryCurrentSet`: the Keychain itself refuses to hand the value
 back without a successful Face ID or Touch ID check, and — this is the part
 that matters — it destroys the item if the enrolled face or fingerprints
 change. Planner never keeps a second copy, and the item lives on this device
 only (`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`), so it does not travel
 through iCloud Keychain or a backup.

 The failure vocabulary matches src/auth/biometric.ts: a cancelled prompt is
 `cancelled`, an item the OS has thrown away is `invalidated`, and a device that
 cannot do this at all is `unavailable` or `unsupported`. Nothing here prompts
 unless the person asked for it.
 */
@objc(PlannerBiometricPlugin)
public class PlannerBiometricPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlannerBiometricPlugin"
    public let jsName = "PlannerBiometric"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.notmtn.planner.biometric"
    private let account = "vault-key"

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    /// Whether this device can do it, and what to call it. Never prompts.
    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        call.resolve(["available": available, "kind": kindName(context)])
    }

    /// Whether a key is already stored, asked without showing anything.
    @objc func hasKey(_ call: CAPPluginCall) {
        let context = LAContext()
        context.interactionNotAllowed = true
        var query = baseQuery
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // The item exists but is locked behind the biometric check, which is
        // what "present" means here; only a missing item is a no.
        call.resolve(["present": status == errSecSuccess || status == errSecInteractionNotAllowed])
    }

    /// Puts the vault key in the Keychain behind the biometric check.
    @objc func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty, let data = value.data(using: .utf8) else {
            call.reject("There was no key to save.", "failed")
            return
        }
        // Replace whatever was there; a second turn-on means the newest key.
        SecItemDelete(baseQuery as CFDictionary)
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            call.reject("This device cannot protect an unlock with biometrics.", "unavailable")
            return
        }
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessControl as String] = access
        switch SecItemAdd(attributes as CFDictionary, nil) {
        case errSecSuccess:
            call.resolve()
        case errSecAuthFailed, errSecUserCanceled:
            call.reject("Unlock cancelled.", "cancelled")
        // The item is only there when the device has a passcode; without one
        // the Keychain answers as unavailable, which is a device that cannot
        // hold this unlock rather than a failure of the check.
        case errSecNotAvailable, errSecInteractionNotAllowed:
            call.reject("This device cannot check you right now.", "unavailable")
        default:
            call.reject("That could not be turned on just now.", "failed")
        }
    }

    /// Reads the key back, which is the call that shows the Face ID prompt.
    @objc func read(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedReason = call.getString("reason") ?? "Unlock your planner"
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var item: CFTypeRef?
        switch SecItemCopyMatching(query as CFDictionary, &item) {
        case errSecSuccess:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty else {
                call.reject("The saved unlock is no longer on this device.", "invalidated")
                return
            }
            call.resolve(["value": value])
        case errSecUserCanceled, errSecAuthFailed:
            // They changed their mind, or the face did not match. The password
            // form is still there; no need to shout about it.
            call.reject("Unlock cancelled.", "cancelled")
        case errSecItemNotFound:
            // `.biometryCurrentSet` throws the item away when the enrolled face
            // or fingers change, so this is the invalidated case, not a bug.
            call.reject("The saved unlock is no longer on this device.", "invalidated")
        // The item is only there when the device has a passcode; without one
        // the Keychain answers as unavailable, which is a device that cannot
        // hold this unlock rather than a failure of the check.
        case errSecNotAvailable, errSecInteractionNotAllowed:
            call.reject("This device cannot check you right now.", "unavailable")
        default:
            call.reject("That did not unlock your planner.", "failed")
        }
    }

    /// Removes the stored key completely: turning the setting off or signing out.
    @objc func forget(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery as CFDictionary)
        call.resolve()
    }

    private func kindName(_ context: LAContext) -> String {
        if #available(iOS 17.0, *), context.biometryType == .opticID {
            return "iris"
        }
        switch context.biometryType {
        case .faceID:
            return "face"
        case .touchID:
            return "fingerprint"
        default:
            return "biometrics"
        }
    }
}

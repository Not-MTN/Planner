import UIKit
import Capacitor

/**
 The shell's bridge, with Planner's own native plugins registered on it.

 A plugin that lives in this app target — rather than in a package under
 node_modules — is not in the generated registration list, so it has to be
 handed to the bridge by name. This is that hand-off for biometric unlock
 (docs/APPS.md §9); `capacitorDidLoad` runs once the bridge exists and before
 the web view starts loading.
 */
class PlannerBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PlannerBiometricPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PlannerBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

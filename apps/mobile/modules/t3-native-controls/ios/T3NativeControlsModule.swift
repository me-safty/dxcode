import ExpoModulesCore

public final class T3NativeControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("T3NativeControls")

    Function("getShowcaseScene") {
      let arguments = ProcessInfo.processInfo.arguments
      guard
        let flagIndex = arguments.firstIndex(of: "--showcaseScene"),
        arguments.indices.contains(flagIndex + 1)
      else {
        return nil as String?
      }
      return arguments[flagIndex + 1]
    }

    Function("markShowcaseReady") { (scene: String) in
      UserDefaults.standard.set(scene, forKey: "T3ShowcaseReadyScene")
    }

    View(T3HeaderButtonView.self) {
      Prop("label") { (view: T3HeaderButtonView, label: String) in
        view.setLabel(label)
      }
      Prop("systemImage") { (view: T3HeaderButtonView, systemImage: String) in
        view.setSystemImage(systemImage)
      }

      Events("onTriggered")
    }
  }
}

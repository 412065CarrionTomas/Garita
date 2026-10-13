import CoreLocation
import ExpoModulesCore

public class GaritaNativeModule: Module, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var pendingPromise: Promise?
  private var timeoutWork: DispatchWorkItem?

  public func definition() -> ModuleDefinition {
    Name("GaritaNative")
    AsyncFunction("getCapabilities") { () -> [String: Any] in
      ["moduleVersion": "1.0.0", "simulationDetectionAvailable": ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15]
    }
    AsyncFunction("getCurrentLocation") { (options: [String: Any], promise: Promise) in
      guard CLLocationManager.authorizationStatus() == .authorizedWhenInUse || CLLocationManager.authorizationStatus() == .authorizedAlways else {
        promise.reject("PERMISSION_DENIED", "Se requiere permiso de ubicación precisa", nil); return
      }
      self.pendingPromise = promise
      self.manager.delegate = self
      self.manager.desiredAccuracy = kCLLocationAccuracyBest
      let timeout = DispatchWorkItem { [weak self] in self?.pendingPromise?.reject("LOCATION_TIMEOUT", "Tiempo de espera agotado", nil); self?.pendingPromise = nil }
      self.timeoutWork = timeout
      let timeoutMs = (options["timeoutMs"] as? Double) ?? 5000
      DispatchQueue.main.asyncAfter(deadline: .now() + timeoutMs / 1000, execute: timeout)
      self.manager.requestLocation()
    }
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last, let promise = pendingPromise else { return }
    timeoutWork?.cancel(); pendingPromise = nil
    let simulated: String
    if #available(iOS 15.0, *) { simulated = location.sourceInformation?.isSimulatedBySoftware == true ? "simulated" : "not_simulated" }
    else { simulated = "unavailable" }
    promise.resolve(["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude, "accuracyMeters": location.horizontalAccuracy, "timestamp": ISO8601DateFormatter().string(from: location.timestamp), "simulation": simulated])
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    pendingPromise?.reject("LOCATION_UNAVAILABLE", error.localizedDescription, error); pendingPromise = nil; timeoutWork?.cancel()
  }
}

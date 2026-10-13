import CoreLocation
import ExpoModulesCore

private final class LocationRequest: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let promise: Promise
  private let onFinish: () -> Void
  private var timeoutWork: DispatchWorkItem?
  private var isSettled = false

  init(promise: Promise, onFinish: @escaping () -> Void) {
    self.promise = promise
    self.onFinish = onFinish
    super.init()
  }

  func start(timeoutMs: Double) {
    let authorizationStatus: CLAuthorizationStatus
    if #available(iOS 14.0, *) {
      authorizationStatus = manager.authorizationStatus
    } else {
      authorizationStatus = CLLocationManager.authorizationStatus()
    }
    guard authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways else {
      reject(code: "PERMISSION_DENIED", message: "Se requiere permiso de ubicación precisa")
      return
    }

    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    let timeout = DispatchWorkItem { [weak self] in
      self?.reject(code: "LOCATION_TIMEOUT", message: "Tiempo de espera agotado")
    }
    timeoutWork = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutMs / 1000, execute: timeout)
    manager.requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else {
      reject(code: "LOCATION_UNAVAILABLE", message: "No se recibió una ubicación")
      return
    }

    let simulation: String
    if #available(iOS 15.0, *) {
      simulation = location.sourceInformation?.isSimulatedBySoftware == true ? "simulated" : "not_simulated"
    } else {
      simulation = "unavailable"
    }
    finish {
      self.promise.resolve([
        "latitude": location.coordinate.latitude,
        "longitude": location.coordinate.longitude,
        "accuracyMeters": location.horizontalAccuracy,
        "timestamp": ISO8601DateFormatter().string(from: location.timestamp),
        "simulation": simulation,
      ])
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish {
      self.promise.reject("LOCATION_UNAVAILABLE", error.localizedDescription, error)
    }
  }

  private func reject(code: String, message: String) {
    finish {
      self.promise.reject(code, message, nil)
    }
  }

  private func finish(_ settlePromise: () -> Void) {
    guard !isSettled else { return }
    isSettled = true
    timeoutWork?.cancel()
    timeoutWork = nil
    manager.stopUpdatingLocation()
    manager.delegate = nil
    settlePromise()
    onFinish()
  }
}

public class GaritaNativeModule: Module {
  private var pendingRequests: [UUID: LocationRequest] = [:]

  public func definition() -> ModuleDefinition {
    Name("GaritaNative")
    AsyncFunction("getCapabilities") { () -> [String: Any] in
      ["moduleVersion": "1.0.0", "simulationDetectionAvailable": ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15]
    }
    AsyncFunction("getCurrentLocation") { (options: [String: Any], promise: Promise) in
      let requestId = UUID()
      let request = LocationRequest(promise: promise) { [weak self] in
        self?.pendingRequests.removeValue(forKey: requestId)
      }
      self.pendingRequests[requestId] = request
      request.start(timeoutMs: (options["timeoutMs"] as? Double) ?? 5000)
    }.runOnQueue(.main)
  }
}

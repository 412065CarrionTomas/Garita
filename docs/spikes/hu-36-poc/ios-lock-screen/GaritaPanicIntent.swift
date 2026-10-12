import AppIntents
import ActivityKit
import Foundation

/**
 * Intención ejecutable en segundo plano desde la Actividad en Vivo en Pantalla Bloqueada (iOS 17+).
 * 
 * FACTORES CLAVE DE ARQUITECTURA:
 * 1. Adopta LiveActivityIntent (protocolo específico para interactividad en Live Activities).
 * 2. openAppWhenRun = false: No obliga a abrir la app principal en primer plano.
 * 3. authenticationPolicy = .alwaysAllowed: Permite que iOS ejecute la acción en segundo plano
 *    AUNQUE LA PANTALLA ESTÉ BLOQUEADA, sin forzar desbloqueo con Face ID o código numérico.
 * 4. RESTRICCIÓN INSALVABLE DE iOS:
 *    - Por conexión de datos (Internet): Puede realizar URLSession POST en segundo plano hacia la API.
 *    - Por SMS: iOS NO permite bajo ningún concepto invocar MFMessageComposeViewController ni emitir
 *      SMS de forma desatendida desde una extensión en segundo plano. Si no hay conexión de datos,
 *      la app debe requerir que el usuario desbloquee para presentar la pantalla nativa de SMS.
 */
@available(iOS 17.0, *)
public struct TriggerPanicIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Activar Alerta de Pánico"
    public static var description = IntentDescription("Emite una alerta silenciosa de pánico a la central de Garita")

    // Clave 1: Mantiene la ejecución en segundo plano (background extension process)
    public static var openAppWhenRun: Bool = false

    // Clave 2: Evita el bloqueo del sistema que exige desbloquear el iPhone
    public static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Shift ID")
    public var shiftId: String

    public init() {
        self.shiftId = ""
    }

    public init(shiftId: String) {
        self.shiftId = shiftId
    }

    public func perform() async throws -> some IntentResult {
        NSLog("[GaritaPanicIntent] Activación de pánico desde pantalla bloqueada. Turno: %@", shiftId)

        // 1. Obtener token de autenticación desde el App Group compartido
        let userDefaults = UserDefaults(suiteName: "group.com.garita.app")
        let authToken = userDefaults?.string(forKey: "garita_shift_token") ?? ""
        let apiBaseUrl = userDefaults?.string(forKey: "garita_api_url") ?? "https://api.garita.com"

        // 2. Intentar despacho directo por Internet (HTTPS POST)
        let alertSent = await sendPanicViaNetwork(baseUrl: apiBaseUrl, token: authToken, shiftId: shiftId)

        // 3. Actualizar el estado visual de la Live Activity
        let newState = GaritaPanicActivityAttributes.ContentState(
            status: alertSent ? "ALERTA_EMITIDA" : "FALLO_RED_ABRIR_APP",
            lastUpdate: Date(),
            alertMessage: alertSent ? "Pánico recibido por central" : "Sin conexión: Toque para abrir SMS"
        )

        for activity in Activity<GaritaPanicActivityAttributes>.activities {
            if activity.attributes.shiftId == shiftId {
                await activity.update(ActivityContent(state: newState, staleDate: nil))
            }
        }

        return .result()
    }

    private func sendPanicViaNetwork(baseUrl: String, token: String, shiftId: String) async -> Bool {
        guard let url = URL(string: "\(baseUrl)/api/alertas-panico") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 6.0
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = [
            "id": UUID().uuidString,
            "shiftId": shiftId,
            "source": "IOS_LOCK_SCREEN_LIVE_ACTIVITY",
            "triggeredAt": ISO8601DateFormatter().string(from: Date())
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) {
                NSLog("[GaritaPanicIntent] Alerta enviada con éxito por Internet (HTTP %d)", httpResponse.statusCode)
                return true
            }
        } catch {
            NSLog("[GaritaPanicIntent] Fallo de red en envío de alerta: %@", error.localizedDescription)
        }

        return false
    }
}

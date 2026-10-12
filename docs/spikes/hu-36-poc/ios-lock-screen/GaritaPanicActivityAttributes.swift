import ActivityKit
import Foundation

/**
 * Atributos estáticos y estado dinámico de la Actividad en Vivo de Turno y Pánico en Garita.
 * Requiere iOS 16.1+ y ActivityKit.
 */
public struct GaritaPanicActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Estado dinámico que puede mutar durante el turno
        public var status: String // "EN_TURNO" | "ALERTA_EMITIDA" | "ALERTA_CONFIRMADA"
        public var lastUpdate: Date
        public var alertMessage: String?
        
        public init(status: String = "EN_TURNO", lastUpdate: Date = Date(), alertMessage: String? = null) {
            self.status = status
            self.lastUpdate = lastUpdate
            self.alertMessage = alertMessage
        }
    }

    // Propiedades fijas inicializadas al comenzar el turno del vigilador
    public var shiftId: String
    public var guardName: String
    public var propertyName: String
    public var startTime: Date

    public init(shiftId: String, guardName: String, propertyName: String, startTime: Date = Date()) {
        self.shiftId = shiftId
        self.guardName = guardName
        self.propertyName = propertyName
        self.startTime = startTime
    }
}

import ActivityKit
import SwiftUI
import WidgetKit

/**
 * Vista de SwiftUI para la Actividad en Vivo (Pantalla Bloqueada y Dynamic Island) en iOS.
 */
@available(iOS 17.0, *)
public struct GaritaPanicLiveActivityView: Widget {
    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: GaritaPanicActivityAttributes.self) { context in
            // Vista en Pantalla Bloqueada
            LockScreenBannerView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // Estado expandido de la Dynamic Island
                DynamicIslandExpandedRegion(.leading) {
                    Label("Garita", systemImage: "shield.fill")
                        .font(.caption2)
                        .foregroundColor(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.status == "ALERTA_EMITIDA" ? "EMERGENCIA" : "EN TURNO")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .green)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(context.attributes.propertyName)
                                .font(.caption)
                                .fontWeight(.semibold)
                            Text(context.attributes.guardName)
                                .font(.caption2)
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        Button(intent: TriggerPanicIntent(shiftId: context.attributes.shiftId)) {
                            Text("PÁNICO")
                                .fontWeight(.black)
                                .foregroundColor(.white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Color.red)
                                .cornerRadius(8)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "shield.fill")
                    .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .blue)
            } compactTrailing: {
                Text(context.state.status == "ALERTA_EMITIDA" ? "SOS" : "OK")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .green)
            } minimal: {
                Image(systemName: "shield.fill")
                    .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .blue)
            }
        }
    }
}

@available(iOS 17.0, *)
struct LockScreenBannerView: View {
    let context: ActivityViewContext<GaritaPanicActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.checkerboard")
                .font(.system(size: 28))
                .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .blue)

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.propertyName)
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                
                Text(context.state.alertMessage ?? "Turno activo: \(context.attributes.guardName)")
                    .font(.caption2)
                    .foregroundColor(context.state.status == "ALERTA_EMITIDA" ? .red : .gray)
            }

            Spacer()

            // Botón interactivo en pantalla bloqueada
            // Gracias a LiveActivityIntent + authenticationPolicy: .alwaysAllowed,
            // ejecuta el perform() de red directamente sin pedir Face ID ni código.
            Button(intent: TriggerPanicIntent(shiftId: context.attributes.shiftId)) {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("PÁNICO")
                        .fontWeight(.black)
                }
                .font(.caption)
                .foregroundColor(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(context.state.status == "ALERTA_EMITIDA" ? Color.orange : Color.red)
                .cornerRadius(10)
            }
        }
        .padding(14)
    }
}

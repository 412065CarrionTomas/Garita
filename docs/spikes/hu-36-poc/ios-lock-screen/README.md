# PoC iOS Pánico en Pantalla Bloqueada (HU-36 / CA6)

Prueba de concepto, análisis de arquitectura y procedimiento de ejecución para el acceso al botón de pánico con el **iPhone bloqueado (HU-22)** utilizando **Actividades en Vivo (Live Activities / ActivityKit)** e intenciones interactivas (`LiveActivityIntent`) en iOS 17+.

---

## 1. Comparativa de alternativas en iOS

En la investigación del Bloque 4 se evaluaron 3 mecanismos disponibles en el ecosistema iOS:

| Criterio                                 | 1. Widget de Pantalla Bloqueada (WidgetKit)                                                                                           | 2. Atajo del Sistema (Siri Shortcuts / Action Button)                                                                                          | 3. Actividad en Vivo (Live Activities / ActivityKit) **[Elegida]**                                                            |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Pasos requeridos**                     | 2 pasos: encender pantalla + tocar widget.                                                                                            | 1 paso (presionar botón de acción o doble tap atrás).                                                                                          | **2 pasos:** encender pantalla + presionar botón "Pánico".                                                                    |
| **¿Envía por Internet sin desbloquear?** | ❌ **No.** Apple exige autenticación obligatoria (Face ID / Código) para cualquier botón interactivo en Lock Screen widgets estándar. | ⚠️ **Condicional.** Solo si no muestra UI ni solicita parámetros; suele exigir desbloqueo si el atajo invoca APIs con red externa restringida. | ✅ **Sí (en iOS 17+).** Mediante `LiveActivityIntent` con `authenticationPolicy = .alwaysAllowed` y `openAppWhenRun = false`. |
| **¿Envía SMS sin desbloquear?**          | ❌ **Imposible.** Restricción de seguridad de iOS.                                                                                    | ❌ **Imposible sin UI.** No puede invocar SMS desatendido sin interacción del usuario.                                                         | ❌ **Imposible sin desbloquear.** El sistema operativo bloquea el envío de SMS desatendido.                                   |
| **Ciclo de vida acotado al turno**       | ❌ Estático: permanece en pantalla todo el tiempo, incluso fuera de turno.                                                            | ❌ Estático: el atajo está siempre disponible en el dispositivo.                                                                               | ✅ **Dinámico:** Inicia automáticamente al abrir turno (`iniciarTurno`) y se destruye al cerrarlo (`finalizarTurno`).         |
| **Viabilidad en Expo**                   | Media (requiere config plugin nativo).                                                                                                | Baja/Manual (requiere configuración manual por parte del usuario en app Atajos).                                                               | ✅ **Alta:** Config plugin de EAS Build (`@bacons/apple-targets` o plugin Swift personalizado).                               |

### Decisión de Arquitectura:

Se selecciona la **Actividad en Vivo (Live Activity)** como la solución oficial para iPhone. Es la **única** que:

1. Permite ejecutar una petición de red silenciosa en segundo plano directamente desde la pantalla bloqueada sin exigir desbloqueo por Face ID o contraseña (`.alwaysAllowed`).
2. Aparece únicamente durante el turno del vigilador y desaparece al finalizarlo.

---

## 2. La restricción insalvable de iOS con respecto al SMS

> **ADVERTENCIA DE SEGURIDAD DE APPLE:**  
> En el sistema operativo iOS, **ninguna aplicación de terceros tiene permitido enviar un mensaje SMS en segundo plano sin intervención gráfica del usuario**.  
> La única API pública provista por Apple es `MFMessageComposeViewController` (o el scheme `sms:`), la cual exige:
>
> 1. Que la aplicación esté en primer plano con su interfaz visible.
> 2. Que el usuario presione manualmente el botón verde "Enviar" del sistema.

Por lo tanto:

- **Con Internet disponible:** La Live Activity envía la alerta inmediatamente a la API de Garita en segundo plano (0 desbloqueos, 0 sonidos).
- **Sin Internet (Fallo de red):** La Live Activity actualiza su estado a `"Sin conexión: Toque para abrir SMS"`. Al tocarlo, iOS despierta la app principal (requiriendo el desbloqueo biométrico habitual), la cual presenta de inmediato la pantalla del sistema con el mensaje de pánico pre-armado listo para enviar (cumpliendo con HU-23).

---

## 3. Requisitos previos para ejecutar la PoC

1. Computadora Mac con macOS Sonoma (14+) o Sequoia (15+).
2. Xcode 15 o superior instalado.
3. iPhone físico con iOS 17.0+ (o Simulador de iPhone en Xcode con iOS 17+).
4. Cuenta de desarrollador de Apple (gratuita o de pago) para firma de desarrollo.

---

## 4. Estructura de archivos de la PoC

- `GaritaPanicActivityAttributes.swift`: Modelo de datos de la actividad (turno, predio, vigilador y estado dinámico).
- `GaritaPanicIntent.swift`: Intención `LiveActivityIntent` con `openAppWhenRun = false` y `authenticationPolicy = .alwaysAllowed`.
- `GaritaPanicLiveActivityView.swift`: Interfaz SwiftUI que renderiza el banner en la pantalla de bloqueo y los estados de la Dynamic Island.
- `ExpoConfigPluginExample.js`: Script de configuración para EAS Prebuild.

---

## 5. Pasos exactos para compilar y ejecutar en Xcode

1. **Crear proyecto base en Xcode:**
   - Abrir Xcode > _Create a new Xcode project_ > _iOS App_ (SwiftUI, Bundle ID `com.garita.app`).
2. **Agregar la Extensión de Widgets:**
   - Menú _File_ > _New_ > _Target..._ > Seleccionar **Widget Extension**.
   - Nombre: `GaritaWidgets`.
   - Marcar la casilla **Include Live Activity**.
3. **Copiar los archivos de esta PoC:**
   - Copiar `GaritaPanicActivityAttributes.swift`, `GaritaPanicIntent.swift` y `GaritaPanicLiveActivityView.swift` dentro del grupo `GaritaWidgets`.
   - Asegurarse de que en el inspector de archivos (Target Membership), los archivos estén tildados tanto para `GaritaWidgets` como para el target principal `com.garita.app`.
4. **Habilitar Live Activities en Info.plist:**
   - En el `Info.plist` de la app principal, agregar:
     - `NSSupportsLiveActivities = YES`
5. **Configurar App Groups (opcional para desarrollo local):**
   - En _Signing & Capabilities_, agregar la capacidad _App Groups_ con el identificador `group.com.garita.app` en ambos targets.
6. **Código para iniciar la actividad en la app principal (`App.swift`):**
   ```swift
   import SwiftUI
   import ActivityKit

   @main
   struct GaritaApp: App {
       var body: some Scene {
           WindowGroup {
               ContentView()
                   .onAppear {
                       startShiftActivity()
                   }
           }
       }

       func startShiftActivity() {
           guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
           let attributes = GaritaPanicActivityAttributes(
               shiftId: "shift_test_001",
               guardName: "Pedro Díaz",
               propertyName: "Depósito Ruta 9"
           )
           let initialContent = ActivityContent(
               state: GaritaPanicActivityAttributes.ContentState(status: "EN_TURNO"),
               staleDate: nil
           )
           do {
               _ = try Activity.request(attributes: attributes, content: initialContent)
               print("✅ Live Activity iniciada con éxito")
           } catch {
               print("❌ Error al iniciar actividad: \(error)")
           }
       }
   }
   ```
7. **Compilar y correr:**
   - Seleccionar como destino el iPhone físico (o simulador de iPhone 15/16).
   - Presionar _Run_ (`Cmd + R`).
   - Abrir la app (se creará la Live Activity).
   - Bloquear la pantalla del iPhone (`Cmd + L` en simulador o presionar botón lateral en físico).
   - Encender la pantalla: verificar que el banner de Garita está visible con el botón "PÁNICO".
   - **Tocar el botón "PÁNICO":** verificar en los logs de Xcode que el método `perform()` se ejecuta en segundo plano sin pedir Face ID.

---

## 6. Qué evidencia capturar

1. **Fotografía o video del iPhone bloqueado:** Mostrando el banner de la Live Activity en la pantalla de bloqueo sin haber ingresado el código.
2. **Video de la activación:** Mostrando que al tocar "PÁNICO", el botón reacciona y actualiza el estado a "EMERGENCIA" en la pantalla bloqueada.
3. **Consola de Xcode:** Captura de texto del log `[GaritaPanicIntent] Activación de pánico desde pantalla bloqueada` y la llamada HTTP exitosa.

---

## 7. Dónde registrar los resultados

Anotar los datos en el informe principal:

- Archivo: `docs/spikes/hu-36-canales-panico.md`
- Sección: **Bloque 4: Pánico con el iPhone bloqueado (HU-22)** y **Tabla de Criterios de Aceptación (CA6)**.
- Completar la fecha de corrida, modelo de iPhone probado, versión de iOS y confirmación del comportamiento del Intent.

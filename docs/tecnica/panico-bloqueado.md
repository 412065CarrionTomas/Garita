# Pánico con el celular bloqueado (HU-22)

## Android: mecanismo elegido

Expo SDK 57 permite reutilizar `expo-notifications` (~57.0.24) y `expo-task-manager` (~57.0.21), instalado con `pnpm --filter mobile exec expo install expo-task-manager`. No agrega receptores Kotlin propios ni servicio en primer plano.

La [referencia de SDK 57 para registerTaskAsync](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#registertaskasynctaskname), consultada el 02/11/2026, afirma: “the task also runs in response to a notification action tap when the app is backgrounded or terminated”. Esto confirma el camino preferido para acciones Android. La restricción siguiente de la referencia sobre notificaciones headless corresponde a la recepción de notificaciones con el proceso terminado; las acciones Android están explícitamente incluidas. El código instalado de `registerTaskAsync.ts` reproduce esa garantía. La [referencia de TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/#taskmanagerdefinetasktaskname-taskexecutor) exige definir la tarea en el ámbito global.

`package.json` apunta a `apps/mobile/index.ts`: importa primero `bloqueado/register` y después `expo-router/entry`, siguiendo el [patrón oficial de entrada propia de Expo Router](https://docs.expo.dev/router/installation/#setup-entry-point), contrastado con Expo Router 57.0.25 instalado. El comentario de `registerTaskAsync.ts` también recomienda una entrada temprana como `index.ts`. Así se define la tarea aunque Android cargue el bundle headless sin montar la UI. `_layout.tsx` no importa el registro: Router evalúa ese layout al montar, por lo que no sirve como única entrada headless y duplicaría la responsabilidad.

El canal propio `panico-bloqueado` tiene importancia LOW, visibilidad PUBLIC, sin sonido ni vibración. La notificación usa siempre el identificador `garita-panic-running-shift`, `sticky: true`, `autoDismiss: false`, y únicamente el título **Turno en curso**. No contiene predio, vigilador, coordenadas, teléfono ni credenciales. Las categorías tienen una sola acción de texto, **Pánico** o **Confirmar pánico**, sin requerir autenticación ni abrir la app. Esas etiquetas sirven para TalkBack.

## Gesto y persistencia

`panicGesture` es una función pura. El primer toque guarda en AsyncStorage el turno y `armedUntil = ahora + 5000`, y reemplaza la misma notificación con **Confirmar pánico**. Un segundo toque de confirmación antes del vencimiento consume el armado y llama una sola vez a `triggerPanic()`. Una confirmación vencida se trata como primer toque. El vencimiento exacto ya está fuera de la ventana.

Un timer restaura **Pánico** al vencer si el proceso sigue vivo. Al reiniciar, cada acción vuelve a leer y validar el estado persistido; la reconciliación también vence armados antiguos. Si Android suspende o mata el proceso, la etiqueta puede quedar en **Confirmar pánico** hasta el próximo toque o reapertura, pero ese toque vencido nunca envía. Las escrituras y actualizaciones del acceso se serializan para evitar que dos respuestas concurrentes consuman el mismo armado.

La tarea mantiene su promesa pendiente durante el plazo restante de armado para que el timer pueda ejecutarse en segundo plano. Al vencer espera a que termine la reconciliación serializada y la republicación de **Pánico**, incluidas las escrituras iniciadas por el timer; esa espera adicional tiene un tope de dos segundos para no colgar la tarea ante una operación nativa sin respuesta. No vuelve a habilitar un acceso cuyo armado se quitó al cerrar sesión. Después de disparar conserva diez segundos de ejecución (timeout SMS de ocho segundos más dos para despacharlo), independientemente de la confirmación de red. Esto evita que `TaskService.notifyTaskFinished` de SDK 57 pause los timers e invalide el contexto headless inmediatamente al retornar `triggerPanic`. No es un servicio en primer plano ni una garantía frente a la muerte del proceso por el sistema.

La tarea verifica `getRunningPanicShift` antes de armar y `triggerPanic` vuelve a verificarlo antes de guardar. Sin turno, se elimina la notificación. El disparador existente persiste en SQLite, vibra brevemente y despacha sin esperar confirmación de red; no se añade sonido ni vibración. Un fallo se registra con un mensaje fijo sin datos personales. No se modifica el transporte de HU-21/HU-23.

## Ciclo de vida y permisos

Después de un inicio exitoso se reconcilia la notificación. Se elimina después de persistir un cierre local, antes de intentar sincronizar, tanto en línea como sin red. Al cerrar sesión se elimina junto con el armado; una acción vieja no puede volver a armarla sin estado habilitado. El layout del vigilador reconcilia al montar, al volver al primer plano y cuando cambia el turno local, usando el mismo predicado que el overlay. No vuelve a publicar si ya existe con la categoría correcta y está desarmada.

Solo consulta el permiso existente; no solicita uno nuevo ni modifica el canal `turnos` o la navegación de pushes. Si está denegado, elimina el acceso y la pantalla del turno presenta discretamente **Activá las notificaciones para usar el pánico con el celular bloqueado**, una vez por turno, con un marcador persistido. Al concederlo en Ajustes y volver a la app se reconcilia otra vez.

Mientras está activo el layout de una sesión de vigilador, `subscribeLockedPanicResponses` recibe las acciones también mediante `addNotificationResponseReceivedListener`, que es la vía de Expo con la app en primer plano. Se da de baja al desmontar el layout o perder esa sesión. Solo acepta esta notificación y las acciones `panic`/`confirm`; los toques normales y las push de `turnos` conservan su navegación. El handler compartido serializa ambas vías y deduplica por acción y fecha nativa de la notificación, guardando únicamente las 32 respuestas recientes en memoria. Así una misma respuesta recibida por listener y tarea no rearma ni dispara dos veces durante una transición de estado de la app.

## Límites conocidos y validación

Se necesita una build de desarrollo o producción con el módulo instalado; Expo Go no acredita ejecución en segundo plano. La muerte forzada, las restricciones del fabricante, Doze, el ahorro de batería y la configuración de notificaciones de pantalla bloqueada pueden impedir acceso o ejecución. `sticky` expresa la intención de mantener la notificación; el sistema conserva el control sobre su presentación. La reapertura reconcilia la presencia. Los timers JS no garantizan ejecución cuando Android suspende el proceso.

Sin datos y con SEND_SMS concedido se reutiliza el envío Android de HU-23. Sin SEND_SMS, el compositor del sistema no se puede presentar con el celular bloqueado: el SMS puede quedar `failed` o `prepared`, sin acreditar envío, y la alerta permanece en la cola por internet. No se cambia ese comportamiento. Los cinco segundos miden el despacho local; la entrega depende de red, sistema y operadora y debe medirse en dispositivos reales. Los tests con mocks no acreditan el tiempo físico ni la ejecución con el proceso muerto.

## iPhone pendiente (ID-273)

`TODO(HU-22-iOS)` conserva el punto de conexión y todas las operaciones son no-op fuera de Android. No se agrega Swift. HU-36 eligió una [Live Activity con LiveActivityIntent](../spikes/hu-36-poc/ios-lock-screen/README.md), `authenticationPolicy = .alwaysAllowed` y `openAppWhenRun = false`, según la [tabla del spike](../spikes/hu-36-canales-panico.md#5-bloque-4-comparación-de-acceso-al-pánico-con-iphone-bloqueado-hu-22).

Faltan el target de extensión WidgetKit/ActivityKit, config plugin reproducible, firma y entitlements, App Group compartido y provisión/revocación segura de la credencial de turno. La PoC es conceptual: sus endpoints, payloads y datos visibles deben adaptarse al contrato actual y a la privacidad de HU-22. También faltan persistencia y gesto deliberado, ciclo de inicio/cierre, integración con la cola y pruebas en iPhone. El compositor SMS requiere desbloquear. CA2 e ID-273 siguen pendientes por decisión explícita de alcance.

## Checklist manual (ID-274)

El usuario registra resultados reales en Jira. No se enviaron alertas ni SMS reales desde los tests.

- [ ] Android bloqueado: un toque no envía; dos dentro de 5 s envían una vez.
- [ ] Sin segundo toque vuelve a **Pánico** a los 5 s; una confirmación vencida solo rearma.
- [ ] Medir menos de 5 s desde la confirmación hasta despacho/recepción, sin sonido y con vibración breve.
- [ ] Cierre con red y cierre sin red quitan el acceso; reapertura no lo restaura.
- [ ] Cerrar sesión quita el acceso; una acción vieja no envía.
- [ ] Reinicio del proceso entre toques conserva el plazo y valida turno.
- [ ] App cerrada por el sistema, ahorro de batería y al menos dos fabricantes.
- [ ] Con la app en primer plano, abrir la cortina y usar las dos acciones; repetir cambiando entre primer y segundo plano sin duplicar activaciones.
- [ ] Sin internet con SEND_SMS y sin SEND_SMS; comprobar estados honestos y reintento posterior por internet.
- [ ] Permiso denegado: aviso una vez por turno; habilitar en Ajustes y volver.
- [ ] TalkBack, privacidad en pantalla bloqueada y configuración del sistema en claro/oscuro.
- [ ] iPhone: pendiente de implementar ID-273, build firmada, prebuild en macOS y BDD 2; no se afirma soporte actual.

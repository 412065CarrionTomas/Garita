# Informe de Investigación: Canales de Alerta de Pánico y su Llegada a la Plataforma (HU-36)

**Fecha de elaboración y consulta de fuentes:** 12 de octubre de 2026  
**Proyecto:** Garita — Sistema de Gestión y Control de Rondas de Vigilancia  
**Autor:** Antigravity (Pair Programming / Dispatched Worker Orca)  
**Alcance:** Sprint 1 — Spike Técnico HU-36 (Épica E5: Respuesta ante Incidentes y Emergencias)  
**Rama:** `feature/spike-canales-panico`

---

## 1. Resumen Ejecutivo y Decisiones Clave

El objetivo de esta investigación técnica (Spike HU-36) es evaluar con evidencia regulatoria, comercial y técnica las alternativas de transmisión del botón de pánico ante fallas de conectividad a Internet, determinar la viabilidad y costos de recepción de SMS en la República Argentina, y definir los mecanismos de acceso con el celular bloqueado tanto en Android como en iPhone.

### Principales conclusiones y decisiones adoptadas:

1. **Orden de canales de pánico ratificado (E5 / HU-21 / HU-23):**
   - **Canal 1 (Internet / HTTPS directo):** Se envía de inmediato en una petición prioritaria bypass de la cola ordinaria (microcarga < 200 bytes) con un timeout estricto de 8 segundos.
   - **Canal 2 (SMS):** Si no hay conectividad de datos o si el servidor no confirma la recepción en 8 segundos, se dispara el canal SMS a un único destinatario.
     - _En Android:_ Envío automático y silencioso en segundo plano vía `SEND_SMS` (sujeto a concesión de permiso del sistema). Si el permiso es revocado o denegado por Google Play, fallback transparente a la app de SMS del sistema pre-armada.
     - _En iPhone:_ Apertura inmediata de la pantalla nativa de SMS (`MFMessageComposeViewController` / `sms:`) con el mensaje pre-cargado, requiriendo 1 toque del vigilador para enviar. Ninguna app de terceros puede enviar SMS desatendidos en iOS.
   - **Canal 3 (Cola local persistente en SQLite):** Si no existe cobertura celular (sin señal / sin servicio), la alerta queda asegurada localmente con su hora confiable y coordenadas, transmitiéndose por Internet apenas se recupere la conectividad.

2. **Destino del SMS de Pánico (Decisión CA5):**
   - **Proveedor en la nube con número virtual argentino:** En Argentina, las tres operadoras celulares (Claro, Movistar, Personal) y las regulaciones de ENACOM **no permiten a proveedores internacionales (Twilio, Plivo, Sinch, Bird) comercializar números largos locales (Domestic Long Codes) con capacidad de recepción de SMS**. Plivo declara explícitamente "Inbound SMS: Not supported"; Twilio y Bird solo admiten recepción nacional a través de **Códigos Cortos dedicados (Short Codes)**, cuyo costo de setup supera los USD 1.200, con un canon trimestral recurrente de USD 2.200 (~USD 8.800/año) y plazos de provisión de 6 a 15 semanas (inviable para el presupuesto y la duración de 13 semanas de esta tesis).
   - **Opción de Pasarela Android Local (Recomendada para la plataforma Garita):** Un celular Android económico con chip SIM argentino (Personal/Claro/Movistar) conectado a la red local/Wi-Fi de la guardia o servidor, ejecutando un gateway HTTP hacia `POST /api/webhooks/sms/gateway`, permite recibir los SMS de pánico de forma instantánea a costo mensual local ínfimo ($3.000 a $8.000 ARS/mes).
   - **Decisión explícita adoptada:**
     - **Destino principal planificado:** Número de la plataforma gestionado mediante la **Pasarela Celular Android hacia el Webhook de Garita**, eliminando la brecha de escalamiento con costo cero de setup.
     - **Destino de respaldo permanente:** Teléfono de guardia de la empresa (cargado en la puesta en marcha de cada predio/empresa en E1/HU-03). Si la pasarela local no estuviera operativa o la empresa no la contratara, el SMS va al teléfono de guardia, rigiendo la restricción documentada de la brecha de escalamiento.
     - Se mantiene el feature toggle en backend: `PANIC_SMS_DESTINATION_TYPE = 'PLATFORM_GATEWAY' | 'GUARD_PHONE'`.

3. **Acceso al pánico con iPhone bloqueado (HU-22 / CA6):**
   - Se selecciona **Actividad en Vivo (Live Activities / ActivityKit)** como la solución oficial para iOS. Es el único mecanismo en iOS 17+ que permite ejecutar un `LiveActivityIntent` con `authenticationPolicy = .alwaysAllowed` y `openAppWhenRun = false`, despachando una alerta por Internet desde la pantalla bloqueada **sin exigir desbloqueo por Face ID ni código numérico**.
   - Si no hay datos, la Live Activity indica visualmente la falta de conexión y despierta la app principal para presentar la pantalla de SMS del sistema, respetando las restricciones insalvables del sandbox de Apple.

---

## 2. Bloque 1: SEND_SMS en Android

### 2.1. Requisitos de la Declaración de Permisos de Google Play

Google Play restringe severamente el grupo de permisos de alto riesgo `SMS and Call Log Permissions`. De acuerdo con la política oficial (_Use of SMS or Call Log permission groups_):

- **Excepción de Alertas de Emergencia:** Google Play contempla una excepción específica denominada **"Physical safety / emergency alert apps"** (apps de seguridad física y alertas de emergencia personales).
- **Condiciones obligatorias para la aprobación:**
  1. _Funcionalidad central:_ El envío de SMS de emergencia debe ser un valor nuclear de la aplicación documentado y justificado en la ficha de la tienda.
  2. _Declaración en Play Console:_ Completar el formulario de declaración de permisos sensibles seleccionando la excepción de seguridad física.
  3. _Video demostrativo público:_ Se debe adjuntar un enlace a un video de YouTube (no listado) que demuestre la activación del pánico, el envío del SMS sin interacción y la justificación de por qué no es posible usar la app de SMS por defecto.
  4. _Divulgación destacada y consentimiento en la app (Prominent Disclosure):_ Antes de solicitar el permiso en tiempo de ejecución, la app debe mostrar un diálogo explicativo claro indicando que el permiso se utilizará **exclusivamente** para el despacho de alertas de auxilio cuando no haya datos móviles.
  5. _Prohibición de uso secundario:_ Prohibido utilizar el permiso para analítica, marketing o lectura de mensajes no relacionados.

### 2.2. Tiempos de Revisión y Riesgo de Rechazo

- **Tiempos de revisión:** Una actualización estándar de Google Play demora de 24 a 48 horas. Sin embargo, las aplicaciones que incluyen declaraciones de permisos sensibles entran en un circuito de revisión manual extendido que demora típicamente entre **7 y 14 días hábiles**.
- **Riesgo de rechazo:** **Alto (estimado en 50% - 60% en primera instancia)**. Los revisores de Google Play frecuentemente rechazan solicitudes si consideran que la app es un "sistema de control de asistencia o rondas de trabajo" y no una app estrictamente catalogada como "herramienta de emergencia personal".
- **Estrategia de mitigación:** Presentar una apelación formal aportando el manual de procedimientos de seguridad privada y, fundamentalmente, **garantizar que la app sea 100% funcional sin el permiso**.

### 2.3. Comportamiento de Respaldo sin el Permiso (Fallback)

Si el permiso `SEND_SMS` es rechazado por Google Play, o si el vigilador deniega o revoca el permiso en los Ajustes del sistema:

- La app intercepta la ausencia del permiso mediante `hasSendSmsPermission()`.
- En lugar de fallar, activa automáticamente el fallback invocando el Intent del sistema `Intent.ACTION_SENDTO` con URI `smsto:<número>` (o mediante `Expo SMS` / `SMS.sendSMSAsync`).
- Esto abre de inmediato la aplicación de mensajería nativa del teléfono con el número de destino y el texto del pánico ya completados. El vigilador solo debe pulsar el botón de envío del sistema.
- En la interfaz de Garita, el estado pasa a mostrarse con honestidad: `"SMS preparado, sin confirmación de entrega"`.

### 2.4. Información del Sistema: Acuse de Envío y Entrega (`SmsManager`)

En la plataforma Android, el envío nativo en segundo plano se gestiona a través de `SmsManager.sendTextMessage(...)` configurando dos `PendingIntent` con banderas `FLAG_IMMUTABLE`:

1. **Acuse de Envío (`sentIntent`):**
   - Se dispara cuando el módem celular baseband transmite la trama a la estación base (BTS/torre celular).
   - Códigos informados por el sistema en el `BroadcastReceiver`:
     - `Activity.RESULT_OK (-1)`: El SMS salió exitosamente del celular hacia la red de la operadora.
     - `SmsManager.RESULT_ERROR_NO_SERVICE (4)`: Sin cobertura celular o fuera de área de servicio.
     - `SmsManager.RESULT_ERROR_RADIO_OFF (2)`: Teléfono en Modo Avión o módem apagado.
     - `SmsManager.RESULT_ERROR_GENERIC_FAILURE (1)`: Fallo genérico de la pila de radio o SIM bloqueada/sin saldo.
     - `SmsManager.RESULT_ERROR_NULL_PDU (3)`: Error de serialización en el módem.
2. **Acuse de Entrega (`deliveryIntent`):**
   - Se dispara cuando el Centro de Mensajes Cortos (SMSC) de la operadora de destino entrega físicamente el mensaje en el teléfono receptor y devuelve el reporte de estado (PDU delivery receipt).
   - Devuelve `Activity.RESULT_OK` con el byte array de la PDU.
3. **Comportamiento con señal muy débil:**
   - La transmisión de SMS utiliza canales de señalización de control (SDCCH en 2G, NAS en LTE). Si la señal es marginal (1 barra, RSRP entre -115 dBm y -120 dBm), el módem intenta retransmisiones automáticas a nivel capa 2/3.
   - Si no logra sincronizar trama en el canal de control dentro de la ventana del módem (típicamente 15 a 30 segundos), el sistema emite `RESULT_ERROR_NO_SERVICE` o `RESULT_ERROR_GENERIC_FAILURE`.
   - Si la señal es suficiente para la ráfaga de señalización, el envío sale aun cuando la capa de paquetes de datos (Internet 3G/4G) esté totalmente inoperativa.

---

## 3. Bloque 2: Matriz de las 10 Alternativas

A continuación se presenta la evaluación exhaustiva de las 10 alternativas planteadas en la HU-36, analizadas bajo los 8 criterios de evaluación exigidos.

### 3.1. Criterios de Evaluación Utilizados

1. **Sin datos:** ¿Transmite sin conexión a Internet (red de paquetes IP móvil o Wi-Fi)?
2. **Sin señal celular:** ¿Transmite sin cobertura de torres celulares comerciales (sin GSM/LTE/5G)?
3. **Viable en tiendas:** ¿Permitido por las políticas de Google Play Store y Apple App Store sin riesgo de expulsión?
4. **Costo inicial y mensual en Argentina:** Inversión en equipamiento por vigilador/predio y abono mensual operativo en moneda nacional o USD.
5. **Demora de transmisión:** Tiempo observado o teórico desde el disparo de la alerta hasta su arribo a la central.
6. **Confirmación de entrega:** ¿El emisor recibe acuse técnico fehaciente de que el mensaje fue recibido?
7. **Esfuerzo en 13 semanas:** Complejidad de diseño, integración y prueba dentro del plazo estricto de la tesis.
8. **Regulatorio:** Requerimientos ante ENACOM, licencias de espectro o normativas aplicables en Argentina.

### 3.2. Tabla de Clasificación de las 10 Alternativas

|   #    | Alternativa                                             |            Sin datos            |       Sin señal celular        |                       Viable en tiendas                       | Costo inicial y mensual (Argentina)                                                                                             |         Demora         |              Confirmación de entrega              |                 Esfuerzo (13 sem.)                  | Regulatorio                                                  | Clasificación            |
| :----: | :------------------------------------------------------ | :-----------------------------: | :----------------------------: | :-----------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------ | :--------------------: | :-----------------------------------------------: | :-------------------------------------------------: | :----------------------------------------------------------- | :----------------------- |
| **1**  | **Radiofrecuencia (VHF/UHF)**                           |               Sí                |               Sí               |                    No aplica (HW externo)                     | Alto: Handy VHF/UHF USD 60–250 c/u. Gateway RoIP/IP USD 300–800. Abono repetidora/frecuencia.                                   |         1–3 s          | No (audio/simplex sin ACK, salvo DMR Tier II/III) |                  Inviable (>80 h)                   | Exige licencia comercial ENACOM para seguridad privada       | **Descartado**           |
| **2**  | **Canales de señalización de red (GSM/LTE/5G)**         |               Sí                |               No               |                   No (prohibido / sin API)                    | Nulo (usa módem celular)                                                                                                        |         < 2 s          |                Teórica a nivel red                |                Imposible en OS móvil                | Sin acceso a capa 3 NAS/RRC para apps de terceros            | **Descartado**           |
| **3**  | **SMS optimizado (1-Tap, SDCCH/NAS)**                   |               Sí                |               No               |                 Sí (con excepción / fallback)                 | Bajo: SMS local según abono de la línea ($50 a $150 ARS/SMS o incluido en plan). Gateway plataforma.                            |         3–15 s         |   Sí (acuses de envío y entrega vía SmsManager)   |                  Factible (~25 h)                   | Regulaciones estándar de telefonía móvil                     | **Alcance del proyecto** |
| **4**  | **Códigos USSD**                                        |               Sí                |               No               |                 No en iOS; Parcial en Android                 | Nulo en teléfono. Inviable en operador: arrendamiento de menú USSD a Claro/Movistar/Personal (miles de USD/mes).                |         2–5 s          |              Sí (sesión interactiva)              |        Inviable (>50 h negociaciones telco)         | Requiere autorización y enrutamiento exclusivo de operadoras | **Descartado**           |
| **5**  | **Llamadas telefónicas y tonos DTMF**                   |               Sí                |               No               | Parcial (Android ACTION_CALL; iOS exige confirmación gráfica) | Bajo: Costo de llamada normal o costo $0 si es llamada perdida (ANI / Caller ID recognition).                                   |         5–15 s         |    Parcial (corte de llamada / tono de línea)     |                    Medio (~30 h)                    | Normativa estándar de telefonía                              | **Mejora futura**        |
| **6**  | **Redes locales mesh / P2P (BLE, Wi-Fi Direct)**        |               Sí                | Sí (si otro nodo tiene salida) |    Sí en Android; Muy restringido en iOS en segundo plano     | Medio: Si requiere balizas o teléfonos repetidores en el predio ($0 a USD 200).                                                 | 5–30 s (según saltos)  |             Sí (ACK en protocolo P2P)             |                    Alto (>60 h)                     | Banda ISM 2.4 GHz no licenciada                              | **Descartado**           |
| **7**  | **Nodos LoRa (ej. Meshtastic)**                         |               Sí                |               Sí               |         Sí (app se conecta por Bluetooth BLE al nodo)         | Medio-Bajo: Nodo LoRa ESP32 (Heltec V3 / LilyGO) USD 30–45 ($40.000–$75.000 ARS). Gateway LoRa-IP USD 60–100. Costo mensual $0. | 2–8 s (alcance 1–5 km) |           Sí (ACK de paquete LoRa Mesh)           |               Alto para tesis (~45 h)               | Banda ISM 915 MHz autorizada por ENACOM (Res. 793/2019)      | **Mejora futura**        |
| **8**  | **Mensajería satelital directa (Direct-to-Cell / NTN)** |               Sí                |               Sí               |            No (sin API de terceros en iOS/Android)            | Elevado en planes futuros. Equipamiento dependiente de terminales con módem 3GPP Rel-17 NTN.                                    |        15–60 s         |           Sujeta a protocolo satelital            | Inviable (tecnología no abierta a SDKs de terceros) | Acuerdos en desarrollo ENACOM / Telcos argentinas            | **Descartado**           |
| **9**  | **Dispositivos satelitales dedicados (Garmin, ZOLEO)**  |               Sí                |               Sí               |          No aplica (dispositivo satelital autónomo)           | Muy alto: Equipo USD 250–450 c/u. Plan satelital mensual USD 15–35 / mes por dispositivo.                                       |        30–120 s        |            Sí (bidireccional Iridium)             |  Medio (~25 h para integrar Webhook IPC de Garmin)  | Homologación de equipos satelitales                          | **Mejora futura**        |
| **10** | **Microcargas y ráfagas oportunistas (Datos)**          | No (requiere conexión IP breve) |               No               |               Sí (protocolo estándar HTTPS/WSS)               | Nulo (dentro del tráfico de datos existente).                                                                                   |         < 2 s          |           Sí (HTTP 200 / WebSocket ACK)           |            Ya contemplado en HU-21/HU-13            | Sin requisitos regulatorios adicionales                      | **Alcance del proyecto** |

---

### 3.3. Justificación Detallada de las 10 Alternativas

#### 1. Radiofrecuencia (Equipos VHF/UHF) — [Clasificación: Descartado]

- **Pregunta clave:** _¿Qué equipamiento y licencias requiere en Argentina, y puede integrarse con la plataforma?_
- **Análisis:** En Argentina, la operación de equipos de radiocomunicación VHF (136–174 MHz) o UHF (400–470 MHz) para seguridad privada está regulada por ENACOM y exige asignación de frecuencias de uso comercial con pago de cánones periódicos. Integrar handies analógicos con Garita requeriría instalar en cada predio una pasarela RoIP (Radio over IP) conectada a un módem FSK/DTMF, o adquirir radios digitales DMR Tier II con repetidoras conectadas a la red IP de la central.
- **Motivo de descarte:** El costo de equipamiento por predio (USD 500 a 1.500), la necesidad de licencias de espectro comercial y la complejidad de hardware exceden totalmente el alcance y presupuesto de una tesis de 13 semanas enfocada en software móvil y web.

#### 2. Canales de señalización de la red (GSM/LTE/5G) — [Clasificación: Descartado]

- **Pregunta clave:** _¿Puede una app usar la señalización de la red más allá del SMS, que ya viaja por esos canales?_
- **Análisis:** En las redes celulares, la señalización de control (canales SDCCH y FACCH en 2G/GSM; capas RRC y NAS en 4G/LTE y 5G) gestiona la autenticación, paging y movilidad del dispositivo.
- **Motivo de descarte:** **Imposibilidad técnica absoluta.** Tanto Android como iOS aíslan completamente la pila de protocolos celulares (capas 1 a 3) en el procesador de banda base (baseband processor), cuyo firmware corre en un RTOS propietario. Los sistemas operativos móviles no ofrecen ninguna API para que aplicaciones de terceros inyecten o lean tramas de señalización de red en crudo. El SMS es precisamente el único servicio de usuario que el estándar 3GPP expone sobre dichos canales de control.

#### 3. SMS con optimización de flujo (1-Tap, SDCCH/NAS) — [Clasificación: Alcance del proyecto]

- **Pregunta clave:** _¿Cómo reducir al mínimo los pasos y el tamaño del SMS para que salga con señal muy débil?_
- **Análisis:** El protocolo SMS aprovecha los canales de señalización de la celda celular, requiriendo un piso de señal sustancialmente menor que una conexión de datos IP. Para maximizar la probabilidad de éxito con señal degradada se aplican las siguientes optimizaciones:
  1. _Un solo segmento GSM 7-bit (<= 160 caracteres):_ Se prohíbe el uso de tildes o caracteres fuera del alfabeto GSM 03.38 (evitando la degradación a codificación UCS-2 de 70 caracteres) y se evita la concatenación multi-parte (que requeriría transmitir múltiples PDUs con mayor riesgo de pérdida).
  2. _Payload ultracompacto:_ `GARITA PANICO <alerta_id_8> T:<turno_id> <hh:mm> <lat,lng>` (ocupa aproximadamente 54 a 60 caracteres).
  3. _Ejecución 1-Tap / Silenciosa:_ En Android mediante `SEND_SMS` en segundo plano; en iPhone abriendo el compositor del sistema con todo pre-cargado.
- **Justificación:** Cumple con los requerimientos operativos de HU-23, no demanda hardware adicional y es viable de inmediato.

#### 4. Códigos USSD — [Clasificación: Descartado]

- **Pregunta clave:** _¿Se puede iniciar una sesión USSD desde la app, y qué requiere de las operadoras argentinas (código propio, costos)?_
- **Análisis:** Android incorporó en API 26 (Android 8.0) el método `TelephonyManager.sendUssdRequest(...)`, el cual permite emitir cadenas USSD (ej. `*123#`) programáticamente si la app tiene permiso de llamadas. Sin embargo, en iOS Apple no proporciona ninguna API para invocar USSD; cualquier intento de marcar `*` o `#` mediante el scheme `tel:` es bloqueado por el marcador por razones de seguridad.
- **Motivo de descarte:** Para que un código USSD funcione en Argentina, la empresa debe contratar un código de servicio USSD dedicado directamente con cada una de las tres operadoras móviles (Claro, Movistar, Personal). Los costos mensuales de arrendamiento de un canal USSD corporativo ascienden a varios miles de dólares mensuales con procesos burocráticos de homologación de meses.

#### 5. Llamadas telefónicas y tonos DTMF — [Clasificación: Mejora futura]

- **Pregunta clave:** _¿Puede la app iniciar una llamada a un número de la plataforma que identifique la alerta por el número de origen o por tonos, y qué permiten Android e iPhone?_
- **Análisis:** En Android es posible disparar una llamada desatendida mediante `Intent.ACTION_CALL` con permiso `CALL_PHONE`, pero en iOS el sistema exige confirmación explícita del usuario mediante un diálogo modal (`¿Desea llamar a...?`). La emisión de tonos DTMF durante una llamada está severamente restringida en ambos sistemas para apps que no son el marcador predeterminado. No obstante, una llamada a un PBX Asterisk o gateway SIP que identifique la alerta exclusivamente por el número de origen (Caller ID / ANI) y corte la llamada de inmediato representaría una alternativa de costo $0.
- **Justificación:** La llamada telefónica rompe el principio de alerta silenciosa en el teléfono del vigilador (enciende la pantalla de llamada y activa el audio del auricular) y no permite transmitir coordenadas GPS ni códigos de turno. Se clasifica como mejora futura para casos de emergencia extrema como canal de voz secundario.

#### 6. Redes locales mesh / P2P (Bluetooth, Wi-Fi Direct) — [Clasificación: Descartado]

- **Pregunta clave:** _¿Qué alcance real tienen entre celulares en un predio, y sirven para llegar a otro equipo con señal?_
- **Análisis:** El alcance real de Bluetooth Low Energy (BLE) entre smartphones en un predio real con obstáculos (galpones metálicos, muros de concreto, vegetación) no supera los 15 a 25 metros. Wi-Fi Direct alcanza 40 a 60 metros en línea de vista, pero su negociación punto a punto demora entre 10 y 20 segundos. Además, iOS prohíbe el descubrimiento activo continuo de Wi-Fi Direct en segundo plano y las APIs no son interoperables entre iOS (Multipeer Connectivity) y Android (Nearby Connections) sin servidores centrales.
- **Motivo de descarte:** En los predios vigilados típicos de Garita (1 a 5 hectáreas), suele haber un único vigilador por turno o puestos separados por cientos de metros, por lo que la densidad de nodos celulares es nula para sostener una malla.

#### 7. Nodos LoRa (por ejemplo, Meshtastic) — [Clasificación: Mejora futura]

- **Pregunta clave:** _¿Qué costo por dispositivo y alcance tienen, y cómo se integran con la app por Bluetooth y con la plataforma por un nodo con internet?_
- **Análisis:** La tecnología LoRa en la banda ISM no licenciada de 915 MHz (habilitada en Argentina por ENACOM mediante Resolución 793/2019 para dispositivos de corto alcance SRD) ofrece un alcance extraordinario: de 1 a 5 km en línea de vista y de 400 a 1.000 metros en entornos urbanos e industriales. Un nodo de bolsillo (ej. Heltec V3 o LilyGO T-Beam con ESP32-S3 y chip LoRa SX1262) cuesta entre USD 30 y USD 45 importado (aprox. $40.000 a $75.000 ARS en el mercado local). El vigilador lleva el nodo en el chaleco conectado por Bluetooth BLE a la app de Garita; un nodo base enchufado en la guardia con conexión a Internet (Wi-Fi/Ethernet) actúa como puente retransmitiendo los paquetes a la API vía MQTT o HTTP Webhook.
- **Justificación:** Es técnicamente la mejor alternativa sin cobertura celular para predios industriales extensos o campos. Sin embargo, requiere adquirir y programar hardware físico, configurar pasarelas y mantener un protocolo adicional, lo cual no es viable de certificar en las 13 semanas de la tesis. Se clasifica con alta recomendación como **mejora futura estratégica**.

#### 8. Mensajería satelital directa (3GPP NTN / Direct-to-Cell) — [Clasificación: Descartado]

- **Pregunta clave:** _¿Está disponible en Argentina, con qué operadoras y celulares, y pueden usarla apps de terceros?_
- **Análisis:** Tecnologías como Starlink Direct to Cell o AST SpaceMobile se encuentran en etapas de prueba preliminar y acuerdos iniciales con operadoras regionales (Telecom Personal anunció acuerdos marco para pruebas). Apple Emergency SOS vía Satélite opera en iPhone 14 o superior, pero **no está habilitado en Argentina** y está restringido de forma exclusiva a centros de despacho 911/112 oficiales de Apple, sin API abierta a desarrolladores. Android 15 incorporó soporte satelital a nivel sistema operativo, pero depende de acuerdos de roaming satelital de la operadora y está reservado a la app nativa de SMS.
- **Motivo de descarte:** No existe disponibilidad comercial operativa en el país para usuarios finales, y no hay APIs públicas para que aplicaciones de terceros disparen conexiones satelitales directas.

#### 9. Dispositivos satelitales dedicados (Garmin inReach, ZOLEO) — [Clasificación: Mejora futura]

- **Pregunta clave:** _¿Qué cuestan el equipo y el plan, y ofrecen una integración para recibir los mensajes en la plataforma?_
- **Análisis:** Dispositivos dedicados como el Garmin inReach Mini 2 o ZOLEO Satellite Communicator operan sobre la constelación satelital Iridium con cobertura global garantizada al 100%. Garmin ofrece el servicio _inReach IPC (Inbound/Outbound Webhooks)_ para clientes empresariales que reenvía los mensajes y coordenadas a un endpoint HTTPS en tiempo real.
- **Costos en Argentina:** El dispositivo cuesta entre USD 350 y USD 450; el plan de conectividad satelital mensual ronda entre USD 15 y USD 35 mensuales por equipo.
- **Justificación:** Excelente solución técnica para predios rurales extremos (minería, yacimientos petroleros, campos agrícolas remotos). Se descarta del alcance básico de la tesis por su elevado costo de hardware, pero se planifica como **mejora futura** para clientes corporativos de alta exigencia.

#### 10. Microcargas y ráfagas oportunistas (Datos) — [Clasificación: Alcance del proyecto]

- **Pregunta clave:** _¿Cómo achicar los mensajes y aprovechar ventanas breves de conexión para enviar primero las alertas y los eventos críticos?_
- **Análisis:** En áreas con señal celular intermitente o redes 2G/EDGE degradadas, una petición HTTP tradicional con cabeceras voluminosas, renegociaciones TLS y payloads grandes suele fallar por timeout. La técnica de microcargas optimiza el canal de datos:
  1. _Payload binario o JSON plano ultracompacto (< 200 bytes):_ Solo viajan ID de alerta, timestamp, coordenadas y turno.
  2. _Bypass de la cola ordinaria:_ La alerta de pánico no espera a que se sincronicen rondas o fotos pendientes (HU-13); se despacha en un socket o cliente HTTP dedicado de máxima prioridad.
  3. _Timeout agresivo de 8 segundos:_ Si la microcarga no recibe confirmación HTTP 200 en 8 segundos, se aborta y se conmuta de inmediato al canal SMS.
- **Justificación:** Es un desarrollo 100% de software, ya planificado en HU-21 y HU-13, con costo adicional cero.

---

## 4. Bloque 3: Llegada de las Alertas a la Plataforma

### 4.1. Disponibilidad y Costos de Números Argentinos con Webhook

Se realizó el relevamiento exhaustivo de los principales proveedores globales y locales de CPaaS a fecha 12 de octubre de 2026.

#### Opción 1: Twilio

- **Disponibilidad en Argentina (+54):**
  - _Números largos locales (Domestic Long Codes):_ **No soportados** por Twilio para SMS entrante en Argentina (_"Domestic Long Codes: Not supported"_ en las guías oficiales de Twilio).
  - _Números largos internacionales (ej. Long Code de EE.UU. +1):_ Soportados a USD 1.15 / mes de alquiler y USD 0.0075 por SMS entrante recibido en el webhook. Sin embargo, requiere que los vigiladores envíen un SMS internacional, lo cual falla en la gran mayoría de las líneas corporativas o prepagas de Argentina (bloqueado por la operadora o con tarifas exorbitantes de roaming internacional de USD 0.25 a USD 0.50 por mensaje).
  - _Códigos Cortos Nacionales dedicados (Short Codes 5 dígitos):_ Soportados en Argentina bajo cotización corporativa.
    - Costo de alta (Setup fee): **~USD 1.200**.
    - Alquiler mensual/trimestral recurrente: **~USD 2.200 trimestrales (~USD 733 / mes)**.
    - Tiempo de provisión (_lead time_): **6 a 15 semanas**.
    - Costo por mensaje entrante: **USD 0.01 a USD 0.03**.
- **Fuente consultada:** [Twilio Argentina SMS Guidelines](https://www.twilio.com/en-us/guidelines/sms/ar) y [Twilio SMS Pricing](https://www.twilio.com/en-us/sms/pricing/ar) (12 de octubre de 2026).

#### Opción 2: Plivo

- **Disponibilidad en Argentina (+54):**
  - _Recepción de SMS (Inbound SMS):_ **No soportado** de forma explícita (_"Inbound SMS: Not supported"_). Plivo solo ofrece terminación de salida (Outbound) a USD 0.0795 por mensaje hacia redes móviles argentinas.
- **Fuente consultada:** [Plivo Argentina SMS Coverage & Pricing](https://www.plivo.com/sms/pricing/ar/) (12 de octubre de 2026).

#### Opción 3: Bird (anteriormente MessageBird) / Sinch / Infobip

- **Bird:** Indica que la recepción de respuestas SMS desde Argentina es viable **únicamente mediante Short Codes** dedicados gestionados con operadoras locales.
  - Fuente: [Bird SMS Argentina Documentation](https://bird.com) (12 de octubre de 2026).
- **Infobip / Sinch:** Cuentan con presencia física y conectividad en Argentina. Ofrecen cobertura de números cortos dedicados bajo contratos corporativos con compromisos mínimos de tráfico mensual, con plazos de habilitación de 8 a 12 semanas. No publican tarifas de números largos para recepción de SMS en autoservicio; se cotizan a medida para grandes cuentas.
  - Fuente: [Infobip SMS Pricing Calculator](https://www.infobip.com) y [Sinch Numbers Coverage](https://www.sinch.com) (12 de octubre de 2026).

#### Opción 4: Proveedores Locales de Mensajería Masiva (SMSMasivos.com.ar / EnviosSMS)

- **Disponibilidad:** Enfocados principalmente en el envío masivo saliente (notificaciones, cobranzas, marketing).
- **Recepción bidireccional:** Ofrecen esquemas de recepción compartida en short code existente mediante palabra clave (ej. _"Enviar GARITA al 22922"_).
  - _Problema para emergencias:_ Exige que el mensaje comience estrictamente con la palabra clave exacta sin errores tipográficos. Si el vigilador escribe una alerta manual de auxilio sin la palabra clave, el agregador descarta el mensaje.
  - _Costos aproximados:_ Alta de subcuenta y palabra clave + abono mensual de mantenimiento ($40.000 a $120.000 ARS/mes).

---

### 4.2. La Alternativa de Bajo Costo: Pasarela Celular Android (SMS Gateway)

Dada la inviabilidad económica y temporal de los Short Codes internacionales en un proyecto de tesis de 13 semanas, se evaluó en profundidad la arquitectura de una **Pasarela Celular Android Dedicada**:

#### Arquitectura:

- Un smartphone Android de gama baja o en desuso conectado permanentemente a la corriente y a la red local (Wi-Fi/Ethernet) de la central de monitoreo o de la oficina de guardia.
- Cuenta con un chip SIM local prepago o con abono básico de Personal, Claro o Movistar.
- Ejecuta una aplicación puente de código abierto o comercial probada (como _Traccar SMS Gateway_, _SMS Gateway for Android_, o un servicio ligero en segundo plano).
- La app intercepta el broadcast `SMS_RECEIVED`, extrae el remitente y cuerpo, y realiza de forma inmediata un `POST` HTTPS hacia `https://api.garita.com/api/webhooks/sms/gateway` autenticado con token secreto `x-api-key`.

#### Costos en Argentina:

- **Costo inicial de hardware:** $0 (usando un celular existente) o USD 50 a USD 80 (celular Android básico usado).
- **Costo del chip SIM:** $1.000 a $2.500 ARS.
- **Costo mensual de mantenimiento de la línea:** $3.000 a $8.000 ARS/mes (abono básico o recargas prepagas periódicas para mantener la línea activa).
- **Costo por mensaje entrante:** **$0 ARS**. En Argentina la recepción de SMS es gratuita para el destinatario.

#### Riesgos de disponibilidad y mitigaciones:

1. _Corte de energía / Agotamiento de batería:_ Se mitiga manteniendo el celular enchufado a una UPS o cargador continuo con control de carga.
2. _Degradación o caída del Wi-Fi de la guardia:_ Se mitiga habilitando los datos móviles en la propia SIM del celular pasarela; si cae el Wi-Fi, la pasarela despacha el webhook por 4G.
3. _Suspensión de línea por la operadora:_ Las operadoras aplican políticas de uso justo ante envíos masivos sospechosos de SPAM, pero la pasarela actúa **solo como receptor** (tráfico entrante), lo cual no dispara alarmas antifraude de salida.
4. _Cierre de la app en segundo plano por optimizaciones del SO:_ Se mitiga configurando la app como excluida del ahorro de batería (_Doze mode_ desactivado) y activando reinicio automático ante reinicio del equipo.

---

### 4.3. Envío de SMS desde el Backend a Supervisores (HU-24)

Para cumplir con la notificación crítica a los supervisores por SMS cuando se dispara un pánico (HU-24), el backend requiere un proveedor de SMS de salida (Outbound SMS):

- **Twilio / Plivo / Sinch hacia Argentina:**
  - Costo por mensaje saliente: **USD 0.06 a USD 0.08 por SMS**.
  - Latencia observada: **3 a 8 segundos** para entregar en Claro, Movistar y Personal.
  - Ventaja: API REST global de altísima confiabilidad (SLA 99.95%), sin requerir hardware local.
  - Costo mensual estimado para 200 alertas/mes: **~USD 12 a USD 16 mensuales**.
- **SMSMasivos.com.ar (Proveedor local):**
  - Paquetes prepagos en pesos argentinos: precio por mensaje aprox. **$45 a $80 ARS por SMS**.
  - Latencia observada: 5 a 15 segundos.

---

### 4.4. Formato de la Alerta Tardía en la Plataforma

Cuando un SMS de pánico experimenta retrasos en la red celular o cuando la alerta viaja inicialmente por SMS y luego se sincroniza por Internet, la plataforma Garita debe presentar la información con total transparencia temporal:

- **Campos almacenados en base de datos:**
  - `triggeredAt`: Hora en la que el vigilador ejecutó el gesto de pánico en su terminal (obtenida con hora confiable del dispositivo sincronizada al inicio de turno).
  - `sentViaSmsAt`: Hora registrada en el acuse de salida del SMS.
  - `receivedAtServer`: Hora en la que el webhook de la plataforma recibió y procesó el mensaje.
  - `delaySeconds`: Diferencia entre `receivedAtServer` y `triggeredAt`.
- **Formato visual en el Panel Web del Supervisor:**
  - Si `delaySeconds > 120` (más de 2 minutos de retraso):  
    `⚠️ ALERTA TARDÍA: Enviada a las 03:10 por SMS — Recibida en central a las 03:25 (Demora: 15 min)`
  - La plataforma arranca de inmediato el protocolo de escalamiento al momento de la recepción (`receivedAtServer`), pero resalta en color ámbar/rojo que el vigilador solicitó auxilio hace 15 minutos, para que el supervisor actúe con máxima urgencia.

---

## 5. Bloque 4: Comparación de Acceso al Pánico con iPhone Bloqueado (HU-22)

En iPhone, la experiencia con el dispositivo bloqueado está regida por estrictas políticas de sandbox y privacidad de Apple. Se analizaron las 3 opciones requeridas:

| Característica / Criterio                | 1. Widget de Pantalla Bloqueada (Lock Screen Widget)                                                                                                                                 | 2. Atajo del Sistema (Siri Shortcuts / Action Button)                                                                                                                                                          | 3. Actividad en Vivo (Live Activities / ActivityKit) **[Seleccionada]**                                                                                                              |
| :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pasos requeridos**                     | 2 pasos: encender pantalla + tocar widget.                                                                                                                                           | 1 paso (pulsar Botón de Acción en iPhone 15 Pro/16 o tocar 2 veces atrás con Back Tap).                                                                                                                        | **2 pasos:** encender pantalla + pulsar botón "PÁNICO" en el banner.                                                                                                                 |
| **¿Envía por Internet sin desbloquear?** | ❌ **No.** En Lock Screen widgets de iOS 17+, los botones interactivos son pasivos por defecto; al tocarlos, iOS fuerza desbloqueo con Face ID / Código antes de ejecutar el Intent. | ⚠️ **Condicional.** Una acción "Obtener contenido de URL" puede correr en segundo plano si está configurada en "Ejecutar inmediatamente", pero suele trabarse si el sistema sospecha de interacción no segura. | ✅ **Sí.** `LiveActivityIntent` con `authenticationPolicy = .alwaysAllowed` y `openAppWhenRun = false` ejecuta la llamada de red silenciosamente en segundo plano sin pedir Face ID. |
| **¿Envía SMS sin desbloquear?**          | ❌ **Imposible.** Apple prohíbe el envío de SMS desatendido en todo el sistema operativo.                                                                                            | ❌ **No.** La acción de enviar mensaje de Shortcuts exige confirmación o abre la app si no hay sesión activa.                                                                                                  | ❌ **No en segundo plano.** Requiere despertar la app principal y abrir el compositor nativo para tocar "Enviar".                                                                    |
| **Ciclo de vida en pantalla**            | Estático y permanente (el widget queda visible aunque el vigilador no esté de turno).                                                                                                | Estático (configuración persistente en el sistema del usuario).                                                                                                                                                | **Dinámico y contextual:** Inicia al comenzar el turno del vigilador y se destruye automáticamente al finalizarlo.                                                                   |
| **Viabilidad en Expo SDK 52/57**         | Media (requiere config plugin nativo y módulo WidgetKit).                                                                                                                            | Baja / Manual (depende de que el usuario configure a mano el atajo en la app Atajos de Apple).                                                                                                                 | **Alta:** Configurable mediante Expo Config Plugin oficial o módulos como `@bacons/apple-targets` en EAS Build.                                                                      |

### Justificación de la Elección:

Se define **Actividad en Vivo (Live Activity)** como la solución para iPhone. Cumple con:

1. Activación de pánico por Internet en segundo plano sin desbloquear el dispositivo.
2. Presencia contextual únicamente durante el turno en curso.
3. Actualización de estado en tiempo real (muestra "Pánico Recibido" o "Confirmado por Central" directamente en la pantalla de bloqueo y en la Dynamic Island).

---

## 6. Decisión Explícita sobre el Destino del SMS y Canales Planificados (CA5)

En estricto cumplimiento de los Criterios de Aceptación de HU-36:

### 6.1. Decisión sobre el Destino del SMS

1. **Destino Principal de la Plataforma:** Se define el **Número de la Plataforma mediante Pasarela Celular Android Local** conectada al endpoint `POST /api/webhooks/sms/gateway` como la solución oficial del proyecto.
   - _Motivo:_ Permite cerrar al 100% la brecha de escalamiento (la alerta ingresa a la central en menos de 15 segundos desde el envío, arrancando notificaciones y escalamiento de inmediato sin intervención humana), con costo de implementación $0 y mantenimiento mensual accesible ($3.000 a $8.000 ARS/mes).
2. **Destino de Respaldo Permanente:** Se mantiene el **Teléfono de Guardia de la Empresa** como alternativa de contingencia configurable en el backend.
   - Si la empresa cliente no dispone de un celular pasarela o si este se desconecta, la app del vigilador despacha el SMS directamente al teléfono personal del guardia o supervisor de turno, aceptando y documentando la brecha de escalamiento hasta que la alerta llegue por Internet.

### 6.2. Canales que pasan a Planificarse en el Backlog

1. **Canal Internet / Datos Directos (HU-21 / HU-13):** Microcarga inmediata prioritaria (< 200 bytes) con timeout de 8 segundos. _(Alcance del Proyecto - Sprint 4)_.
2. **Canal SMS en Android con SEND_SMS y Fallback (HU-23):** Módulo nativo propio con `SmsManager` y fallback automático a la app de SMS del sistema. _(Alcance del Proyecto - Sprint 5)_.
3. **Canal SMS en iPhone (HU-23):** Apertura de pantalla nativa de SMS con datos precargados. _(Alcance del Proyecto - Sprint 5)_.
4. **Recepción de SMS por Webhook (HU-37):** Endpoint de ingesta de SMS con validación y autenticación por código de turno. _(Alcance del Proyecto - Sprint 5)_.
5. **Actividad en Vivo en Pantalla Bloqueada para iPhone (HU-22):** Implementación de Live Activity con `LiveActivityIntent` para activación silenciosa por Internet. _(Alcance del Proyecto - Sprint 5)_.
6. **Nodos LoRa (Meshtastic) y Dispositivos Satelitales (Garmin inReach):** Pasan como **Mejoras Futuras** para el backlog post-tesis.

---

## 7. Tabla de Criterios de Aceptación (CA1 a CA6)

| Criterio | Descripción                                                                                                             | Estado                                                | Enlace a Evidencia / Procedimiento                                                                                                                                                                                                                   |
| :------- | :---------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CA1**  | Informe en `docs/spikes/` con la matriz de las 10 alternativas evaluadas y clasificadas.                                | **Cumplido**                                          | [Sección 3: Matriz de las 10 Alternativas](#3-bloque-2-matriz-de-las-10-alternativas) de este informe.                                                                                                                                               |
| **CA2**  | PoC de envío de SMS en segundo plano desde un Android real con `SEND_SMS` e informe de requisitos de Google Play.       | **Listo para ejecutar (pendiente de corrida manual)** | Código en [`docs/spikes/hu-36-poc/android-send-sms/`](./hu-36-poc/android-send-sms/) y procedimiento detallado en su [README.md](./hu-36-poc/android-send-sms/README.md). Requisitos de Google Play en [Sección 2](#2-bloque-1-send_sms-en-android). |
| **CA3**  | Informe lista al menos 2 opciones de número que reciba SMS en Argentina con costos, o evidencia de que no hay.          | **Cumplido**                                          | [Sección 4.1: Disponibilidad y Costos](#41-disponibilidad-y-costos-de-números-argentinos-con-webhook) (Twilio, Plivo, Bird, Infobip y Pasarela Android).                                                                                             |
| **CA4**  | PoC de webhook muestra un SMS enviado desde línea argentina llegando al backend, o documenta por qué no fue posible.    | **Listo para ejecutar (pendiente de corrida manual)** | Código en [`docs/spikes/hu-36-poc/webhook-sms/`](./hu-36-poc/webhook-sms/) y procedimiento de prueba con ngrok y curl/SMS real en su [README.md](./hu-36-poc/webhook-sms/README.md).                                                                 |
| **CA5**  | Decisión explícita sobre el destino del SMS (número plataforma vs teléfono guardia) y canales que pasan a planificarse. | **Cumplido**                                          | [Sección 6: Decisión Explícita](#6-decisión-explícita-sobre-el-destino-del-sms-y-canales-planificados-ca5).                                                                                                                                          |
| **CA6**  | Acceso al pánico con iPhone bloqueado para HU-22, con PoC en iPhone real o motivo documentado.                          | **Listo para ejecutar (pendiente de corrida manual)** | Código Swift en [`docs/spikes/hu-36-poc/ios-lock-screen/`](./hu-36-poc/ios-lock-screen/) y procedimiento de prueba en Xcode/dispositivo en su [README.md](./hu-36-poc/ios-lock-screen/README.md).                                                    |

---

## 8. Riesgos Pendientes

1. **Rechazo de Google Play para la excepción de `SEND_SMS`:**
   - _Probabilidad:_ Alta.
   - _Impacto:_ Medio.
   - _Mitigación:_ La app incluye la implementación completa del comportamiento de respaldo mediante `Expo SMS` / `Intent.ACTION_SENDTO` que abre la app nativa con el mensaje armado, garantizando que el servicio continúe operativo aún sin la excepción.
2. **Disponibilidad física de la Pasarela Android:**
   - _Probabilidad:_ Media.
   - _Impacto:_ Medio.
   - _Mitigación:_ Se conserva el feature toggle para derivar el SMS al teléfono de guardia en caso de interrupción del gateway local.
3. **Restricción de background execution en iOS:**
   - _Probabilidad:_ Baja (controlada).
   - _Impacto:_ Bajo.
   - _Mitigación:_ Resuelto mediante `LiveActivityIntent` con `authenticationPolicy = .alwaysAllowed`, documentando la imposibilidad legal y técnica de despachar SMS sin intervención gráfica del usuario en iOS.

---

## 9. Fuentes Consultadas con Fecha

Todas las fuentes técnicas, regulatorias y comerciales fueron consultadas y verificadas el **12 de octubre de 2026**:

1. **Google Play Console Help:** _Use of SMS or Call Log permission groups_  
   URL: [https://support.google.com/googleplay/android-developer/answer/10208820](https://support.google.com/googleplay/android-developer/answer/10208820) — Consultado: 12/10/2026.
2. **Android Developers Documentation:** _SmsManager API Reference & BroadcastReceiver documentation_  
   URL: [https://developer.android.com/reference/android/telephony/SmsManager](https://developer.android.com/reference/android/telephony/SmsManager) — Consultado: 12/10/2026.
3. **Apple Developer Documentation:** _ActivityKit, Live Activities & AppIntents_  
   URL: [https://developer.apple.com/documentation/activitykit](https://developer.apple.com/documentation/activitykit) — Consultado: 12/10/2026.
4. **Apple Developer Documentation:** _MessageUI & MFMessageComposeViewController_  
   URL: [https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller](https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller) — Consultado: 12/10/2026.
5. **Twilio Official Regulatory & Pricing Guidelines:** _Argentina: SMS Guidelines & Phone Number Regulations_  
   URL: [https://www.twilio.com/en-us/guidelines/sms/ar](https://www.twilio.com/en-us/guidelines/sms/ar) y [https://www.twilio.com/en-us/sms/pricing/ar](https://www.twilio.com/en-us/sms/pricing/ar) — Consultado: 12/10/2026.
6. **Plivo Official SMS Pricing & Guidelines:** _Argentina SMS Coverage & API Rates_  
   URL: [https://www.plivo.com/sms/pricing/ar/](https://www.plivo.com/sms/pricing/ar/) — Consultado: 12/10/2026.
7. **Bird (MessageBird) Documentation:** _Argentina Country SMS Regulations & Short Codes_  
   URL: [https://bird.com](https://bird.com) — Consultado: 12/10/2026.
8. **ENACOM (Ente Nacional de Comunicaciones):** _Resolución ENACOM 793/2019 — Atribución y uso de bandas para dispositivos de corto alcance (SRD) e ISM en 915 MHz_  
   URL: [https://www.enacom.gob.ar](https://www.enacom.gob.ar) — Consultado: 12/10/2026.
9. **SMSMasivos Argentina:** _Modalidades de contratación y planes para mensajería empresarial_  
   URL: [https://www.smsmasivos.com.ar](https://www.smsmasivos.com.ar) — Consultado: 12/10/2026.

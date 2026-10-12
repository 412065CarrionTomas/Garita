# PoC Android SEND_SMS (HU-36 / CA2)

Prueba de concepto para verificar el envío automático de SMS de alerta de pánico en segundo plano sin intervención del usuario (`SEND_SMS`) y la captura de acuses de envío y entrega mediante `BroadcastReceiver` en Android.

---

## 1. Requisitos previos

1. **Dispositivo físico Android:**
   - Android 8.0 (API 26) o superior (probado con Android 12, 13 y 14).
   - Celular con chip SIM físico o eSIM activo (Personal, Claro o Movistar Argentina) con saldo o abono para envío de SMS.
   - _Nota:_ No usar emulador Android, ya que no replica fidedignamente el comportamiento de torres celulares ni los acuses de entrega de red de operadoras locales.
2. **Entorno de desarrollo:**
   - Node.js 20+ y pnpm / npm instalados.
   - Android Studio configurado con Android SDK Platform 34 y Android SDK Build-Tools.
   - Dispositivo Android con _Depuración por USB_ activada.

---

## 2. Estructura de la PoC

- `android/`: Módulo nativo en Kotlin basado en **Expo Modules API** (`GaritaSendSmsModule.kt`).
  - Invoca `SmsManager.sendTextMessage(...)`.
  - Registra dos `BroadcastReceiver` dinámicos con `PendingIntent` inmutables:
    - **Sent Receiver:** Notifica si el módem celular transmitió el mensaje a la celda (`Activity.RESULT_OK`) o si hubo falla (`RESULT_ERROR_NO_SERVICE`, `RESULT_ERROR_RADIO_OFF`, etc.).
    - **Delivered Receiver:** Notifica cuando el SMSC de la operadora confirma la entrega en el terminal de destino (PDU receipt).
  - Emite eventos `onSmsSent` y `onSmsDelivered` hacia JavaScript.
- `src/index.ts`: API TypeScript con suscripción a eventos.
- `example/App.tsx`: Pantalla de prueba para solicitar permiso, disparar el SMS y visualizar los acuses en tiempo real.

---

## 3. Pasos exactos para compilar y ejecutar

### Opción A: Probar como módulo local en una app Expo Prebuild

1. Crear un proyecto Expo limpio en una carpeta temporal fuera del monorepo:
   ```bash
   npx create-expo-app@latest poc-sms-runner --template blank-typescript
   cd poc-sms-runner
   ```
2. Instalar el módulo local apuntando a esta carpeta:
   ```bash
   npm install ../worktrees/r1-spike/docs/spikes/hu-36-poc/android-send-sms
   ```
3. Copiar el contenido de `example/App.tsx` en el `App.tsx` de la app de prueba.
4. Generar el proyecto nativo Android:
   ```bash
   npx expo prebuild --platform android
   ```
5. Conectar el celular Android por USB y ejecutar:
   ```bash
   npx expo run:android --device
   ```

### Opción B: Inspeccionar / Compilar directo desde Android Studio

1. Abrir la carpeta `android/` del runner generado en Android Studio.
2. Sincronizar Gradle (`Sync Project with Gradle Files`).
3. Ejecutar la tarea `assembleDebug` o correr directo en el dispositivo seleccionado.

---

## 4. Procedimiento de prueba manual

1. **Prueba 1: Solicitud de permiso y envío con señal normal**
   - Abrir la app. Presionar "Solicitar Permiso" y aceptar en el diálogo del sistema.
   - Ingresar un número de destino válido (por ejemplo, el celular de guardia o un segundo teléfono de prueba).
   - Presionar **ACTIVAR PÁNICO (SEND_SMS)**.
   - Observar el log en pantalla:
     - Debe aparecer `Despacho iniciado`.
     - A los 1-3 segundos debe recibirse `onSmsSent` con estado `OK` (`resultCode = -1`).
     - A los 3-15 segundos (según la operadora) debe recibirse `onSmsDelivered` con `delivered = true`.
     - Verificar en el teléfono de destino que el SMS ingresó en su bandeja.
2. **Prueba 2: Comportamiento en Modo Avión / Sin Señal Celular**
   - Activar "Modo Avión" en el dispositivo emisor.
   - Presionar **ACTIVAR PÁNICO (SEND_SMS)**.
   - Observar el log: el evento `onSmsSent` debe reportar inmediatamente `RADIO_OFF` o `NO_SERVICE` (`resultCode = 4` o `resultCode = 2`).
   - Desactivar Modo Avión.
3. **Prueba 3: Comportamiento sin permiso concedido**
   - En Ajustes de Android > Aplicaciones > Permisos, revocar el permiso de SMS.
   - Abrir la app e intentar presionar el botón de pánico.
   - Verificar que la promesa es rechazada con `PERMISSION_DENIED`, demostrando que la app no crashea y permite activar el flujo de respaldo (abrir la app de SMS del sistema).

---

## 5. Qué evidencia capturar

1. **Captura de pantalla de la app:** Mostrando los logs de `onSmsSent: OK` y `onSmsDelivered: true`.
2. **Foto o captura del celular receptor:** Mostrando el SMS recibido con el texto exacto: `GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877`.
3. **Logcat de Android Studio:** Filtrando por `GaritaSendSms` para verificar el ciclo de vida del PendingIntent.

---

## 6. Dónde registrar los resultados

Anotar los datos en el informe principal:

- Archivo: `docs/spikes/hu-36-canales-panico.md`
- Sección: **Bloque 1: SEND_SMS en Android** y **Tabla de Criterios de Aceptación (CA2)**.
- Completar la fecha de corrida, modelo de celular Android testeado, versión de Android, operadora (Claro/Movistar/Personal) y tiempos observados de entrega.

# PoC Webhook SMS (HU-36 / CA4)

Servidor receptor mínimo (Node.js / Express / TypeScript) diseñado para procesar webhooks de recepción de SMS entrantes provenientes de dos fuentes posibles:

1. **Proveedor CPaaS en la nube (Twilio):** Validación criptográfica de firma HMAC-SHA1 (`X-Twilio-Signature`) y parsing de payload URL-encoded.
2. **Pasarela celular Android local (SMS Gateway):** Autenticación mediante token de seguridad Bearer / `x-api-key` y parsing de payload JSON.

Implementa la lógica completa de autenticación y clasificación de alertas de pánico según las especificaciones de negocio de **HU-23** y **HU-37**:

- Estados posibles: `VALID` (código de turno válido), `UNVERIFIED` (código ausente/inválido pero vigilador activo reconocido por teléfono), `UNKNOWN` (número y código no asociados a turno activo).
- Normalización automática de números argentinos (+54 9, +54, prefijos locales).

---

## 1. Requisitos previos

- Node.js 20+ y npm / pnpm instalados en la máquina.
- Para recibir webhooks desde internet en pruebas locales: [ngrok](https://ngrok.com/) o [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).
- Para prueba de pasarela física: un celular Android con chip SIM argentino y la app **SMS Gateway** (o similar, como Traccar SMS Gateway o SMSMobileAPI) conectada por Wi-Fi a internet.

---

## 2. Instalación y configuración

1. Ingresar a la carpeta de la PoC:
   ```bash
   cd docs/spikes/hu-36-poc/webhook-sms
   ```
2. Instalar dependencias aisladas (no tocan el monorepo ni `pnpm-workspace.yaml`):
   ```bash
   npm install
   ```
3. Crear el archivo `.env` a partir de `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Configurar las variables en `.env`:
   - `PORT=3000`
   - `GATEWAY_API_KEY=clave_secreta_super_segura_garita_123`
   - Si se prueba Twilio: completar `TWILIO_AUTH_TOKEN` y `TWILIO_WEBHOOK_URL`.

---

## 3. Pasos exactos para ejecutar

### Paso 1: Iniciar el servidor local

```bash
npm run dev
```

La consola mostrará:

```
🚀 Garita PoC Webhook SMS escuchando en http://localhost:3000
   - Endpoint Twilio:  POST http://localhost:3000/api/webhooks/sms/twilio
   - Endpoint Gateway: POST http://localhost:3000/api/webhooks/sms/gateway
```

### Paso 2: Exponer el servidor a internet con ngrok

En otra terminal:

```bash
ngrok http 3000
```

Copiar la URL pública generada (ejemplo: `https://a1b2-c3d4.ngrok-free.app`).

---

## 4. Pruebas y verificación

### Prueba A: Simulación de Pasarela Android con curl (Caso VALID)

Enviar un SMS válido generado por la app del vigilador (Pedro Díaz, código de turno `483920`):

```bash
curl -X POST http://localhost:3000/api/webhooks/sms/gateway \
  -H "Content-Type: application/json" \
  -H "x-api-key: clave_secreta_super_segura_garita_123" \
  -d '{
    "from": "+5493511234567",
    "message": "GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877"
  }'
```

**Respuesta esperada:**

```json
{
  "received": true,
  "alertId": "K7Q2M9XA",
  "status": "VALID",
  "reasons": ["Código de turno 483920 verificado correctamente."],
  "timestamp": "..."
}
```

### Prueba B: Caso UNVERIFIED (SMS escrito a mano sin código de turno)

```bash
curl -X POST http://localhost:3000/api/webhooks/sms/gateway \
  -H "Content-Type: application/json" \
  -H "x-api-key: clave_secreta_super_segura_garita_123" \
  -d '{
    "from": "+5493511234567",
    "message": "Ayuda porton norte"
  }'
```

**Resultado en consola:** Estado `UNVERIFIED`, vigilador Pedro Díaz identificado por su número, se activa alerta de emergencia para revisión.

### Prueba C: Caso UNKNOWN (Número no perteneciente a vigilador activo)

```bash
curl -X POST http://localhost:3000/api/webhooks/sms/gateway \
  -H "Content-Type: application/json" \
  -H "x-api-key: clave_secreta_super_segura_garita_123" \
  -d '{
    "from": "+5491199998888",
    "message": "Hola que tal"
  }'
```

**Resultado en consola:** Estado `UNKNOWN`, no genera alerta ni notificaciones, se archiva para auditoría.

### Prueba D: Prueba de extremo a extremo con SMS real desde un celular

1. En el celular Android pasarela (con chip local):
   - Instalar una app tipo _SMS Gateway_ o _SMS Forwarder_ (ej: [SMS Gateway for Android](https://github.com/traccar/traccar-sms-gateway) o app open source).
   - Configurar la URL del webhook en la app: `https://tu-ngrok.ngrok-free.app/api/webhooks/sms/gateway`.
   - Configurar el Header: `x-api-key: clave_secreta_super_segura_garita_123`.
2. Desde otro celular argentino emisor (con cualquier línea):
   - Enviar un SMS al número del celular pasarela con el texto:
     `GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877`
3. Observar la consola de la PoC:
   - En menos de 5 a 15 segundos el SMS debe impactar en el servidor, registrarse con status `VALID`, parsear la latitud/longitud y emitir el log estructurado.

---

## 5. Qué evidencia capturar

1. **Captura de consola:** Salida del servidor mostrando el log estructurado `🚨 RESULTADO PROCESAMIENTO ALERTA` con el status `VALID` y coordenadas parseadas.
2. **Captura de ngrok:** Registro HTTP con código `200 OK` y tiempo de respuesta en milisegundos.
3. **Captura de SMS:** Pantalla del celular emisor con el SMS enviado y hora de emisión.

---

## 6. Dónde registrar los resultados

Anotar los datos en el informe principal:

- Archivo: `docs/spikes/hu-36-canales-panico.md`
- Sección: **Bloque 3: Llegada de las alertas a la plataforma** y **Tabla de Criterios de Aceptación (CA4)**.
- Completar la fecha de corrida, proveedor o pasarela utilizada, tiempo total observado desde el envío del SMS hasta la recepción en el webhook (latencia en segundos) y resultado de la validación.

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { validateTwilioSignature } from './twilioSignature';
import { verifyAndProcessPanicMessage, ProcessedPanicAlert } from './parser';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || 'clave_secreta_super_segura_garita_123';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WEBHOOK_URL = process.env.TWILIO_WEBHOOK_URL || '';

// Middleware para cuerpos URL-encoded (Twilio envía application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));
// Middleware para cuerpos JSON (Pasarela Android SMS Gateway)
app.use(express.json());

// Logger simple de solicitudes entrantes
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'garita-webhook-sms-poc',
  });
});

/**
 * Endpoint para Webhook de Twilio
 * Twilio envía POST con campos: From, To, Body, MessageSid, etc.
 * Cabecera X-Twilio-Signature para validar procedencia.
 */
app.post('/api/webhooks/sms/twilio', (req: Request, res: Response) => {
  const signature = req.headers['x-twilio-signature'] as string | undefined;

  // Si hay authToken configurado, validar firma
  if (TWILIO_AUTH_TOKEN && TWILIO_WEBHOOK_URL) {
    const isValid = validateTwilioSignature(
      signature,
      TWILIO_AUTH_TOKEN,
      TWILIO_WEBHOOK_URL,
      req.body,
    );

    if (!isValid) {
      console.warn(
        '⚠️ [Twilio Webhook] Firma X-Twilio-Signature rechazada. Posible petición falsificada.',
      );
      return res.status(403).type('text/plain').send('Firma de webhook inválida');
    }
  }

  const from = req.body.From || '';
  const body = req.body.Body || '';
  const messageSid = req.body.MessageSid || 'sid_mock';

  console.log(`📥 [Twilio Webhook] Recibido SMS (${messageSid}) de ${from}: "${body}"`);

  const processed: ProcessedPanicAlert = verifyAndProcessPanicMessage(from, body);
  logProcessedAlert(processed, 'TWILIO');

  // Respuesta compatible con TwiML (XML vacío para no emitir SMS de respuesta automática)
  res.set('Content-Type', 'text/xml');
  return res.status(200).send('<Response></Response>');
});

/**
 * Endpoint para Pasarela Celular Android (SMS Gateway)
 * Apps como Traccar SMS Gateway o app personalizada envían JSON:
 * { "from": "+549351...", "message": "GARITA PANICO...", "sent_at": "..." }
 */
app.post('/api/webhooks/sms/gateway', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : apiKeyHeader;

  if (token !== GATEWAY_API_KEY) {
    console.warn('⚠️ [Gateway Webhook] Token de autenticación inválido o ausente.');
    return res.status(401).json({ error: 'No autorizado: API key inválida' });
  }

  const from = req.body.from || req.body.sender || '';
  const message = req.body.message || req.body.text || '';

  if (!from || !message) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: from y message' });
  }

  console.log(`📥 [Android Gateway] Recibido SMS de ${from}: "${message}"`);

  const processed: ProcessedPanicAlert = verifyAndProcessPanicMessage(from, message);
  logProcessedAlert(processed, 'ANDROID_GATEWAY');

  return res.status(200).json({
    received: true,
    alertId: processed.parsed.shortAlertId || 'none',
    status: processed.status,
    reasons: processed.reasons,
    timestamp: processed.receivedAt,
  });
});

function logProcessedAlert(processed: ProcessedPanicAlert, source: string) {
  console.log('----------------------------------------------------');
  console.log(`🚨 RESULTADO PROCESAMIENTO ALERTA (${source})`);
  console.log(`   Estado: [${processed.status}]`);
  console.log(`   Número normalizado: ${processed.normalizedNumber}`);
  console.log(`   Alerta ID corta: ${processed.parsed.shortAlertId || 'N/A'}`);
  console.log(`   Código turno: ${processed.parsed.shiftCode || 'N/A'}`);
  console.log(`   Vigilador ID: ${processed.matchedGuardId || 'No asociado'}`);
  console.log(`   Turno ID: ${processed.matchedShiftId || 'No asociado'}`);
  if (processed.parsed.latitude && processed.parsed.longitude) {
    console.log(
      `   Coordenadas: Lat ${processed.parsed.latitude}, Lng ${processed.parsed.longitude}`,
    );
  }
  console.log(`   Detalle de reglas: ${processed.reasons.join(' | ')}`);
  console.log('----------------------------------------------------');
}

app.listen(PORT, () => {
  console.log(`🚀 Garita PoC Webhook SMS escuchando en http://localhost:${PORT}`);
  console.log(`   - Endpoint Twilio:  POST http://localhost:${PORT}/api/webhooks/sms/twilio`);
  console.log(`   - Endpoint Gateway: POST http://localhost:${PORT}/api/webhooks/sms/gateway`);
});

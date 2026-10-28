import crypto from 'crypto';

/**
 * Valida la firma X-Twilio-Signature enviada por Twilio en webhooks HTTP POST.
 * Según la documentación oficial de Twilio:
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validateTwilioSignature(
  expectedSignature: string | undefined,
  authToken: string,
  url: string,
  params: Record<string, any>,
): boolean {
  if (!expectedSignature || !authToken || !url) {
    return false;
  }

  // Ordenar alfabéticamente las claves de los parámetros POST
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;

  for (const key of sortedKeys) {
    dataToSign += `${key}${params[key]}`;
  }

  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(dataToSign, 'utf8');
  const calculatedSignature = hmac.digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(calculatedSignature, 'utf8'),
    );
  } catch {
    return false;
  }
}

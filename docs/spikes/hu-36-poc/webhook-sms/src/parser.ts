export interface ParsedPanicSms {
  isPanicMessage: boolean;
  shortAlertId?: string;
  shiftCode?: string;
  timeString?: string;
  latitude?: number;
  longitude?: number;
  rawText: string;
}

export type SmsVerificationStatus = 'VALID' | 'UNVERIFIED' | 'UNKNOWN';

export interface ProcessedPanicAlert {
  status: SmsVerificationStatus;
  fromNumber: string;
  normalizedNumber: string;
  parsed: ParsedPanicSms;
  matchedGuardId?: string;
  matchedShiftId?: string;
  receivedAt: string;
  reasons: string[];
}

// Base de datos simulada de turnos y vigiladores en curso para la PoC
export interface ActiveShiftRecord {
  shiftId: string;
  shiftCode: string; // ej: "483920"
  guardId: string;
  guardName: string;
  guardPhone: string; // normalizado ej: "+5493511234567"
}

export const MOCK_ACTIVE_SHIFTS: ActiveShiftRecord[] = [
  {
    shiftId: 'shift_abc123',
    shiftCode: '483920',
    guardId: 'guard_pedro_diaz',
    guardName: 'Pedro Díaz',
    guardPhone: '+5493511234567',
  },
  {
    shiftId: 'shift_def456',
    shiftCode: '991204',
    guardId: 'guard_laura_gomez',
    guardName: 'Laura Gómez',
    guardPhone: '+5491144556677',
  },
];

/**
 * Normaliza números de teléfono argentinos:
 * - "+54 9 351..." -> "+549351..."
 * - "+54 351..." -> "+549351..." (agrega el 9 móvil si es celular)
 * - "0351 15-..." -> "+549351..."
 */
export function normalizeArgentinePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.startsWith('15')) {
    cleaned = cleaned.substring(2);
  }

  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('54')) {
      cleaned = `+${cleaned}`;
    } else {
      cleaned = `+54${cleaned}`;
    }
  }

  // Si tiene +54 pero le falta el 9 móvil (ej +54351... longitud típica de celular > 12)
  if (cleaned.startsWith('+54') && !cleaned.startsWith('+549')) {
    const subscriberPart = cleaned.substring(3);
    // En Argentina los celulares tienen 10 dígitos (código de área + número)
    if (subscriberPart.length === 10) {
      cleaned = `+549${subscriberPart}`;
    }
  }

  return cleaned;
}

/**
 * Parsea el cuerpo del SMS según HU-23:
 * Formato estándar: "GARITA PANICO <alerta_id_8> T:<turno_id> <hh:mm> <lat,lng>"
 * Ejemplo: "GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877"
 */
export function parsePanicSms(body: string): ParsedPanicSms {
  const trimmed = body.trim();
  const isPanic = trimmed.toUpperCase().startsWith('GARITA PANICO');

  if (!isPanic) {
    return {
      isPanicMessage: false,
      rawText: trimmed,
    };
  }

  // Regex para extraer campos
  // GARITA PANICO ([A-Z0-9]{8}) T:([A-Z0-9]+) (\d{1,2}:\d{2}) (-?\d+\.\d+),(-?\d+\.\d+)
  const regex =
    /GARITA\s+PANICO\s+([A-Z0-9]{8})\s+T:([A-Za-z0-9]+)\s+(\d{1,2}:\d{2})\s+(-?\d+\.\d+),(-?\d+\.\d+)/i;
  const match = trimmed.match(regex);

  if (match) {
    return {
      isPanicMessage: true,
      shortAlertId: match[1].toUpperCase(),
      shiftCode: match[2],
      timeString: match[3],
      latitude: parseFloat(match[4]),
      longitude: parseFloat(match[5]),
      rawText: trimmed,
    };
  }

  // Si no coincide con la regex estricta pero empieza con GARITA PANICO
  return {
    isPanicMessage: true,
    rawText: trimmed,
  };
}

/**
 * Evalúa y autentica el mensaje de acuerdo con las reglas de HU-37:
 * - Válido: shiftCode coincide con turno activo.
 * - No verificado: shiftCode inválido pero el número coincide con vigilador en turno.
 * - Desconocido: ni shiftCode ni número coinciden con turno activo.
 */
export function verifyAndProcessPanicMessage(
  fromRaw: string,
  body: string,
  activeShifts: ActiveShiftRecord[] = MOCK_ACTIVE_SHIFTS,
): ProcessedPanicAlert {
  const normalizedFrom = normalizeArgentinePhoneNumber(fromRaw);
  const parsed = parsePanicSms(body);
  const reasons: string[] = [];
  const receivedAt = new Date().toISOString();

  // Buscar turno por shiftCode
  const shiftByCode = parsed.shiftCode
    ? activeShifts.find((s) => s.shiftCode === parsed.shiftCode)
    : undefined;

  // Buscar turno por número de vigilador
  const shiftByPhone = activeShifts.find((s) => s.guardPhone === normalizedFrom);

  if (shiftByCode) {
    // Código válido
    reasons.push(`Código de turno ${parsed.shiftCode} verificado correctamente.`);
    if (shiftByCode.guardPhone !== normalizedFrom) {
      reasons.push(
        `ALERTA: El número de origen (${normalizedFrom}) no coincide con el registrado (${shiftByCode.guardPhone}). Puede ser celular con doble SIM.`,
      );
    }

    return {
      status: 'VALID',
      fromNumber: fromRaw,
      normalizedNumber: normalizedFrom,
      parsed,
      matchedGuardId: shiftByCode.guardId,
      matchedShiftId: shiftByCode.shiftId,
      receivedAt,
      reasons,
    };
  }

  if (shiftByPhone) {
    // Código no válido pero vigilador en turno reconocido
    reasons.push(
      `Mensaje de texto sin código de turno válido, pero número reconocido perteneciente a vigilador activo ${shiftByPhone.guardName}.`,
    );
    return {
      status: 'UNVERIFIED',
      fromNumber: fromRaw,
      normalizedNumber: normalizedFrom,
      parsed,
      matchedGuardId: shiftByPhone.guardId,
      matchedShiftId: shiftByPhone.shiftId,
      receivedAt,
      reasons,
    };
  }

  // Ni código ni teléfono coinciden
  reasons.push(
    'Ni el código de turno ni el número de teléfono coinciden con ningún turno en curso.',
  );
  return {
    status: 'UNKNOWN',
    fromNumber: fromRaw,
    normalizedNumber: normalizedFrom,
    parsed,
    receivedAt,
    reasons,
  };
}

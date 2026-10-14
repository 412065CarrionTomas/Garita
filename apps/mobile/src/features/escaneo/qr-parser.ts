import type { ShiftOfflineData } from '@garita/shared';

export type InvalidQrReason = 'malformed' | 'other_site' | 'outdated_version';

export type QrParseResult =
  | {
      valid: true;
      checkpoint: ShiftOfflineData['checkpoints'][number];
      checkpointId: string;
      version: number;
    }
  | {
      valid: false;
      reason: InvalidQrReason;
      message: string;
      checkpointId?: string;
    };

export function parseAndValidateQr(
  scannedValue: string,
  checkpoints: ShiftOfflineData['checkpoints'],
): QrParseResult {
  const parts = scannedValue.trim().split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== 'GQR1' ||
    !parts[1] ||
    !/^[1-9]\d*$/.test(parts[2] ?? '') ||
    !parts[3]
  ) {
    return {
      valid: false,
      reason: 'malformed',
      message: 'Código QR no válido',
    };
  }

  const checkpointId = parts[1];
  const version = Number(parts[2]);

  const checkpoint = checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) {
    return {
      valid: false,
      reason: 'other_site',
      message: 'Este punto no pertenece a tu turno',
      checkpointId,
    };
  }

  if (checkpoint.qrVersion !== version) {
    return {
      valid: false,
      reason: 'outdated_version',
      message: 'Código QR desactualizado',
      checkpointId,
    };
  }

  return {
    valid: true,
    checkpoint,
    checkpointId,
    version,
  };
}

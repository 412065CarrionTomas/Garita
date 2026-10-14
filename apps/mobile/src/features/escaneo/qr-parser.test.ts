import type { ShiftOfflineData } from '@garita/shared';
import { parseAndValidateQr } from './qr-parser';

const checkpoints: ShiftOfflineData['checkpoints'] = [
  {
    id: 'cp-porton',
    name: 'Portón trasero',
    qrVersion: 1,
    nfcUid: null,
    isIndoor: false,
  },
  {
    id: 'cp-galpon',
    name: 'Galpón 1',
    qrVersion: 2,
    nfcUid: null,
    isIndoor: true,
  },
];

describe('parseAndValidateQr', () => {
  it('identifies a valid QR with matching checkpoint and version', () => {
    const result = parseAndValidateQr(
      'GQR1.cp-porton.1.validSignature123456789012345678901234567890',
      checkpoints,
    );
    expect(result).toEqual({
      valid: true,
      checkpoint: checkpoints[0],
      checkpointId: 'cp-porton',
      version: 1,
    });
  });

  it('rejects malformed QR codes with wrong prefix, missing parts, or non-numeric version', () => {
    expect(parseAndValidateQr('INVALID.cp-porton.1.sig', checkpoints)).toMatchObject({
      valid: false,
      reason: 'malformed',
      message: 'Código QR no válido',
    });
    expect(parseAndValidateQr('GQR1.cp-porton.sig', checkpoints)).toMatchObject({
      valid: false,
      reason: 'malformed',
    });
    expect(parseAndValidateQr('GQR1.cp-porton.0.sig', checkpoints)).toMatchObject({
      valid: false,
      reason: 'malformed',
    });
    expect(parseAndValidateQr('GQR1.cp-porton.version.sig', checkpoints)).toMatchObject({
      valid: false,
      reason: 'malformed',
    });
    expect(parseAndValidateQr('', checkpoints)).toMatchObject({
      valid: false,
      reason: 'malformed',
    });
  });

  it('detects a QR for a checkpoint that does not belong to the shift (other_site)', () => {
    const result = parseAndValidateQr('GQR1.cp-other-site.1.sig123', checkpoints);
    expect(result).toEqual({
      valid: false,
      reason: 'other_site',
      message: 'Este punto no pertenece a tu turno',
      checkpointId: 'cp-other-site',
    });
  });

  it('detects an outdated QR version (outdated_version)', () => {
    // cp-galpon current qrVersion is 2, scan has version 1
    const result = parseAndValidateQr('GQR1.cp-galpon.1.sig123', checkpoints);
    expect(result).toEqual({
      valid: false,
      reason: 'outdated_version',
      message: 'Código QR desactualizado',
      checkpointId: 'cp-galpon',
    });
  });
});

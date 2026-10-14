import { haversineMeters } from './haversine';
import { evaluateRecordFlags } from './evaluator';
import { FLAG_SEVERITY, type EvaluateRecordFlagsInput } from './types';

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMeters(-34.6037, -58.3816, -34.6037, -58.3816)).toBe(0);
  });

  it('computes realistic distances (Obelisco a Plaza de Mayo ~1.1 km)', () => {
    const dist = haversineMeters(-34.6037, -58.3816, -34.6083, -58.3712);
    expect(dist).toBeGreaterThan(1000);
    expect(dist).toBeLessThan(1300);
  });
});

describe('evaluateRecordFlags (HU-15 Criterios de Aceptación y BDD)', () => {
  // Helper to create coordinates roughly N meters apart along the meridian
  // 1 degree latitude ~ 111,195 meters, so 1 meter ~ 1 / 111195 degrees
  const offsetMetersNorth = (lat: number, meters: number) => lat + meters / 111195;

  const baseCheckpoint = {
    id: 'chk-1',
    latitude: -34.6037,
    longitude: -58.3816,
    toleranceRadiusMeters: 30,
    isIndoor: false,
    hasActiveNfcTag: false,
  };

  const defaultSite = {
    maxSpeedKmh: 10, // walking by default
  };

  const createInput = (overrides?: Partial<EvaluateRecordFlagsInput>): EvaluateRecordFlagsInput => {
    const checkpoint = { ...baseCheckpoint, ...(overrides?.checkpoint ?? {}) };
    return {
      record: {
        method: 'qr',
        occurredAtDevice: '2026-10-14T10:00:00.000Z',
        location: {
          status: 'ok',
          latitude: checkpoint.latitude,
          longitude: checkpoint.longitude,
          accuracyMeters: 10,
          simulation: 'not_simulated',
        },
        phoneNfc: 'on',
        ...(overrides?.record ?? {}),
      },
      checkpoint,
      previousRecord: overrides?.previousRecord,
      site: overrides?.site ?? defaultSite,
    };
  };

  describe('CA1 & BDD 1: Fuera de rango', () => {
    it('CA1: un registro a 80 metros de un punto con radio de 30 metros y precisión de 10 metros queda marcado como fuera de rango', () => {
      const lat80m = offsetMetersNorth(baseCheckpoint.latitude, 80);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat80m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'out_of_range',
          severity: 'media',
          reason: 'distance_exceeds_tolerance',
        }),
      );
    });

    it('BDD 1: QR fotografiado y escaneado a 200m de distancia con radio de 30m queda fuera de rango', () => {
      const lat200m = offsetMetersNorth(baseCheckpoint.latitude, 200);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat200m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 15,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'out_of_range',
          severity: 'media',
        }),
      );
    });
  });

  describe('CA2 & BDD 2: Ubicación simulada', () => {
    it('CA2 & BDD 2: un registro con ubicación simulada queda marcado como ubicación simulada (grave)', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'simulated',
          },
          phoneNfc: 'on',
        },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'simulated_location',
          severity: 'grave',
          reason: 'simulated_location_detected',
        }),
      );
    });
  });

  describe('CA3, CA4 & BDD 3: Tiempo imposible', () => {
    it('CA3: en un predio a pie (10 km/h), dos registros en puntos a 500m con 30s de diferencia quedan marcados como tiempo imposible (grave)', () => {
      // 500m in 30s is 60 km/h, which is > 10 km/h
      const prevLat = offsetMetersNorth(baseCheckpoint.latitude, -500);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:30.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: prevLat,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 10 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'impossible_time',
          severity: 'grave',
          reason: 'speed_exceeded',
        }),
      );
    });

    it('CA4: el mismo par de registros en un predio configurado vehículo (60 km/h) no queda marcado', () => {
      // 500m in 30s is 60 km/h, not exceeding vehicle max speed 60 km/h
      const prevLat = offsetMetersNorth(baseCheckpoint.latitude, -500);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:30.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: prevLat,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 60 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'impossible_time')).toBe(false);
    });

    it('BDD 3: dos puntos a 2 km con 3 minutos de diferencia en predio vehículo (40 km/h <= 60 km/h) no se marca', () => {
      // 2000m in 180s = 40 km/h
      const prevLat = offsetMetersNorth(baseCheckpoint.latitude, -2000);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:03:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: prevLat,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 60 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'impossible_time')).toBe(false);
    });
  });

  describe('CA6: Niveles de gravedad', () => {
    it('asigna correctamente las gravedades según el tipo de marca', () => {
      expect(FLAG_SEVERITY.simulated_location).toBe('grave');
      expect(FLAG_SEVERITY.impossible_time).toBe('grave');
      expect(FLAG_SEVERITY.out_of_range).toBe('media');
      expect(FLAG_SEVERITY.location_disabled).toBe('media');
      expect(FLAG_SEVERITY.qr_on_tagged_point).toBe('media');
      expect(FLAG_SEVERITY.location_unverifiable).toBe('leve');
    });
  });

  describe('CA7 & BDD 5: QR en punto con etiqueta NFC', () => {
    it('con NFC apagado (nfc_off), marca qr_on_tagged_point de gravedad media', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'off',
        },
        checkpoint: { ...baseCheckpoint, hasActiveNfcTag: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'qr_on_tagged_point',
          severity: 'media',
          reason: 'nfc_off',
        }),
      );
    });

    it('con NFC encendido (nfc_on), marca qr_on_tagged_point de gravedad media', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, hasActiveNfcTag: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'qr_on_tagged_point',
          severity: 'media',
          reason: 'nfc_on',
        }),
      );
    });

    it('con celular sin NFC (unsupported), NO se marca', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'unsupported',
        },
        checkpoint: { ...baseCheckpoint, hasActiveNfcTag: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'qr_on_tagged_point')).toBe(false);
    });

    it('si el método es nfc, NO se marca', () => {
      const input = createInput({
        record: {
          method: 'nfc',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, hasActiveNfcTag: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'qr_on_tagged_point')).toBe(false);
    });
  });

  describe('CA8: Ubicación desactivada', () => {
    it('con ubicación desactivada (disabled), queda marcado como location_disabled (media)', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'disabled',
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            simulation: 'unavailable',
          },
          phoneNfc: 'on',
        },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'location_disabled',
          severity: 'media',
          reason: 'location_disabled',
        }),
      );
    });
  });

  describe('CA9 & BDD 6: Puntos interiores', () => {
    it('CA9 & BDD 6: en un punto interior, un registro sin ubicación o impreciso no genera marcas de ubicación', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'unverifiable',
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            simulation: 'unavailable',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, isIndoor: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(
        flags.filter((f) => f.type.startsWith('location_') || f.type === 'out_of_range'),
      ).toHaveLength(0);
    });

    it('en un punto interior, no se evalúa fuera de rango aunque la ubicación esté lejos', () => {
      const latFar = offsetMetersNorth(baseCheckpoint.latitude, 500);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: latFar,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, isIndoor: true, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(false);
    });

    it('en un punto interior, si la ubicación es simulada, sí se marca', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, isIndoor: true },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'simulated_location',
          severity: 'grave',
        }),
      );
    });
  });

  describe('CA10 & BDD 4: Precisión de GPS', () => {
    it('CA10: registro a 80m de un punto con radio de 30m y precisión de 90m NO queda marcado como fuera de rango', () => {
      // 80m - 90m = -10m <= 30m, and accuracy <= 100m, so neither out_of_range nor location_unverifiable
      const lat80m = offsetMetersNorth(baseCheckpoint.latitude, 80);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat80m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 90,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(false);
      expect(flags.some((f) => f.type === 'location_unverifiable')).toBe(false);
    });

    it('BDD 4: GPS impreciso con precisión de 250m queda marcado como location_unverifiable (leve) y no se evalúa fuera de rango', () => {
      const lat200m = offsetMetersNorth(baseCheckpoint.latitude, 200);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat200m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 250,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(false);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'location_unverifiable',
          severity: 'leve',
          reason: 'low_accuracy',
        }),
      );
    });
  });

  describe('Casos de borde', () => {
    it('exactamente en el radio de tolerancia: distancia - precisión === radio no se marca', () => {
      // distance = 40m, accuracy = 10m, tolerance = 30m. margin = 40 - 10 = 30 === tolerance
      const lat40m = offsetMetersNorth(baseCheckpoint.latitude, 40);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat40m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(false);
    });

    it('exactamente 100m de precisión: se evalúa fuera de rango y NO es location_unverifiable', () => {
      // accuracy 100m <= 100m
      const lat150m = offsetMetersNorth(baseCheckpoint.latitude, 150);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat150m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 100,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'location_unverifiable')).toBe(false);
      // margin = 150 - 100 = 50 > 30 -> out of range
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(true);
    });

    it('precisión de 100.1m: es location_unverifiable y NO evalúa fuera de rango', () => {
      const lat150m = offsetMetersNorth(baseCheckpoint.latitude, 150);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: lat150m,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 100.1,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        checkpoint: { ...baseCheckpoint, toleranceRadiusMeters: 30 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'location_unverifiable')).toBe(true);
      expect(flags.some((f) => f.type === 'out_of_range')).toBe(false);
    });

    it('mismo punto repetido: distancia 0 (< 100m) entre puntos consecutivos no evalúa tiempo imposible', () => {
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:01.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: baseCheckpoint.id,
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 10 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'impossible_time')).toBe(false);
    });

    it('puntos a 90 metros (< 100m) no evalúan tiempo imposible aunque la diferencia de tiempo sea 1 segundo', () => {
      const lat90m = offsetMetersNorth(baseCheckpoint.latitude, 90);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:01.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: lat90m,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 10 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'impossible_time')).toBe(false);
    });

    it('intervalo cero (0 segundos) entre puntos a 200m (>= 100m) marca tiempo imposible con velocidad infinita', () => {
      const lat200m = offsetMetersNorth(baseCheckpoint.latitude, 200);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: lat200m,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 10 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags).toContainEqual(
        expect.objectContaining({
          type: 'impossible_time',
          severity: 'grave',
        }),
      );
    });

    it('velocidad exactamente igual a la máxima del predio NO se marca como tiempo imposible', () => {
      // 500m in 180s = 10 km/h, max speed = 10 km/h
      const lat500m = offsetMetersNorth(baseCheckpoint.latitude, 500);
      const input = createInput({
        record: {
          method: 'qr',
          occurredAtDevice: '2026-10-14T10:03:00.000Z',
          location: {
            status: 'ok',
            latitude: baseCheckpoint.latitude,
            longitude: baseCheckpoint.longitude,
            accuracyMeters: 10,
            simulation: 'not_simulated',
          },
          phoneNfc: 'on',
        },
        previousRecord: {
          occurredAtDevice: '2026-10-14T10:00:00.000Z',
          checkpoint: {
            id: 'chk-prev',
            latitude: lat500m,
            longitude: baseCheckpoint.longitude,
          },
        },
        site: { maxSpeedKmh: 10 },
      });

      const flags = evaluateRecordFlags(input);
      expect(flags.some((f) => f.type === 'impossible_time')).toBe(false);
    });
  });
});

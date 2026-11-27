import { haversineMeters } from './haversine';
import { isTimeAltered, type DeviceClock } from '../field/trusted-time';
import { FLAG_SEVERITY, type EvaluatedFlag, type EvaluateRecordFlagsInput } from './types';

export function evaluateTimeFlags(
  clock: DeviceClock | undefined,
  receivedAt?: string | Date,
): EvaluatedFlag[] {
  const flags: EvaluatedFlag[] = [];
  if (clock?.timeStatus === 'unverifiable') {
    flags.push({
      type: 'time_unverifiable',
      severity: FLAG_SEVERITY.time_unverifiable,
      reason: 'boot_without_reference',
    });
  }
  if (clock?.trustedAt) {
    const offset = Date.parse(clock.deviceTime) - Date.parse(clock.trustedAt);
    const future =
      receivedAt !== undefined && Date.parse(clock.trustedAt) > new Date(receivedAt).getTime();
    if (
      future ||
      (clock.referenceOffsetMs !== null && isTimeAltered(offset, clock.referenceOffsetMs))
    ) {
      flags.push({
        type: 'time_altered',
        severity: FLAG_SEVERITY.time_altered,
        reason: future ? 'trusted_time_in_future' : 'device_offset_changed',
        details: { deviceOffsetMs: offset, referenceOffsetMs: clock.referenceOffsetMs },
      });
    }
  }
  return flags;
}

/** Pares de puntos más cercanos no se evalúan por tiempo imposible. */
export const IMPOSSIBLE_TIME_MIN_METERS = 100;

/**
 * Pure and deterministic evaluation of suspicious record flags according to HU-15.
 *
 * Rules:
 * - simulated_location: simulation === 'simulated' (grave)
 * - out_of_range: distance - accuracy > radius, only if accuracy <= 100m, outdoor checkpoints only (media)
 * - location_unverifiable: accuracy > 100m or location status === 'unverifiable', outdoor checkpoints only (leve)
 * - location_disabled: location status === 'disabled', outdoor checkpoints only (media)
 * - qr_on_tagged_point: method === 'qr' on checkpoint with active tag, if phoneNfc is 'on' or 'off' (media); no flag if 'unsupported'
 * - impossible_time: speed between consecutive checkpoints (using configured coordinates) > max speed of the pair, only if distance >= IMPOSSIBLE_TIME_MIN_METERS (grave)
 * - indoor checkpoints: neither out_of_range nor lack of location / accuracy is flagged
 */
export function evaluateRecordFlags(input: EvaluateRecordFlagsInput): EvaluatedFlag[] {
  const flags = evaluateTimeFlags(input.record.clock, input.record.receivedAt);
  const { record, checkpoint, previousRecord, speed } = input;

  // 1. Simulated location (grave) - applies regardless of indoor/outdoor
  if (record.location.simulation === 'simulated') {
    flags.push({
      type: 'simulated_location',
      severity: FLAG_SEVERITY.simulated_location,
      reason: 'simulated_location_detected',
      details: { simulation: 'simulated' },
    });
  }

  // 2. Location evaluation (only for outdoor checkpoints)
  if (!checkpoint.isIndoor) {
    if (record.location.status === 'disabled') {
      flags.push({
        type: 'location_disabled',
        severity: FLAG_SEVERITY.location_disabled,
        reason: 'location_disabled',
        details: { status: 'disabled' },
      });
    } else if (record.location.status === 'unverifiable') {
      flags.push({
        type: 'location_unverifiable',
        severity: FLAG_SEVERITY.location_unverifiable,
        reason: 'no_gps_fix',
        details: { status: 'unverifiable' },
      });
    } else {
      const { accuracyMeters: accuracy, latitude, longitude } = record.location;
      if (latitude === null || longitude === null || accuracy === null || accuracy > 100) {
        flags.push({
          type: 'location_unverifiable',
          severity: FLAG_SEVERITY.location_unverifiable,
          reason: latitude === null || longitude === null ? 'no_gps_fix' : 'low_accuracy',
          details: { status: 'ok', accuracyMeters: accuracy },
        });
      } else {
        const distance = haversineMeters(
          latitude,
          longitude,
          checkpoint.latitude,
          checkpoint.longitude,
        );
        const margin = distance - accuracy;
        if (margin > checkpoint.toleranceRadiusMeters) {
          flags.push({
            type: 'out_of_range',
            severity: FLAG_SEVERITY.out_of_range,
            reason: 'distance_exceeds_tolerance',
            details: {
              distanceMeters: Math.round(distance * 100) / 100,
              accuracyMeters: accuracy,
              toleranceRadiusMeters: checkpoint.toleranceRadiusMeters,
            },
          });
        }
      }
    }
  }

  // 3. QR on tagged point (media)
  if (record.method === 'qr' && checkpoint.hasActiveNfcTag) {
    if (record.phoneNfc === 'off') {
      flags.push({
        type: 'qr_on_tagged_point',
        severity: FLAG_SEVERITY.qr_on_tagged_point,
        reason: 'nfc_off',
        details: { phoneNfc: 'off' },
      });
    } else if (record.phoneNfc === 'on') {
      flags.push({
        type: 'qr_on_tagged_point',
        severity: FLAG_SEVERITY.qr_on_tagged_point,
        reason: 'nfc_on',
        details: { phoneNfc: 'on' },
      });
    }
    // phoneNfc === 'unsupported' -> no flag generated (reported as shift metadata)
  }

  // 4. Impossible time (grave)
  if (previousRecord) {
    const checkpointDistance = haversineMeters(
      previousRecord.checkpoint.latitude,
      previousRecord.checkpoint.longitude,
      checkpoint.latitude,
      checkpoint.longitude,
    );

    if (checkpointDistance >= IMPOSSIBLE_TIME_MIN_METERS) {
      const tCurrent = new Date(record.clock?.trustedAt ?? record.occurredAtDevice).getTime();
      const tPrevious = new Date(
        previousRecord.trustedAt ?? previousRecord.occurredAtDevice,
      ).getTime();
      const timeDeltaSeconds = (tCurrent - tPrevious) / 1000;

      let speedKmh: number;
      if (timeDeltaSeconds <= 0) {
        speedKmh = Infinity;
      } else {
        speedKmh = (checkpointDistance / timeDeltaSeconds) * 3.6;
      }

      if (speedKmh > speed.maxSpeedKmh) {
        flags.push({
          type: 'impossible_time',
          severity: FLAG_SEVERITY.impossible_time,
          reason: 'speed_exceeded',
          details: {
            speedKmh: Number.isFinite(speedKmh) ? Math.round(speedKmh * 100) / 100 : 'infinity',
            maxSpeedKmh: speed.maxSpeedKmh,
            distanceMeters: Math.round(checkpointDistance * 100) / 100,
            timeDeltaSeconds,
          },
        });
      }
    }
  }

  return flags;
}

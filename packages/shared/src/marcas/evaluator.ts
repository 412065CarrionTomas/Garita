import { haversineMeters } from './haversine';
import { FLAG_SEVERITY, type EvaluatedFlag, type EvaluateRecordFlagsInput } from './types';

/**
 * Pure and deterministic evaluation of suspicious record flags according to HU-15.
 *
 * Rules:
 * - simulated_location: simulation === 'simulated' (grave)
 * - out_of_range: distance - accuracy > radius, only if accuracy <= 100m, outdoor checkpoints only (media)
 * - location_unverifiable: accuracy > 100m or location status === 'unverifiable', outdoor checkpoints only (leve)
 * - location_disabled: location status === 'disabled', outdoor checkpoints only (media)
 * - qr_on_tagged_point: method === 'qr' on checkpoint with active tag, if phoneNfc is 'on' or 'off' (media); no flag if 'unsupported'
 * - impossible_time: speed between consecutive checkpoints (using configured coordinates) > site max speed, only if distance >= 100m (grave)
 * - indoor checkpoints: neither out_of_range nor lack of location / accuracy is flagged
 */
export function evaluateRecordFlags(input: EvaluateRecordFlagsInput): EvaluatedFlag[] {
  const flags: EvaluatedFlag[] = [];
  const { record, checkpoint, previousRecord, site } = input;

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
    } else if (record.location.status === 'ok') {
      const accuracy = record.location.accuracyMeters;
      if (accuracy === null || accuracy > 100) {
        flags.push({
          type: 'location_unverifiable',
          severity: FLAG_SEVERITY.location_unverifiable,
          reason: 'low_accuracy',
          details: { status: 'ok', accuracyMeters: accuracy },
        });
      } else if (record.location.latitude !== null && record.location.longitude !== null) {
        const distance = haversineMeters(
          record.location.latitude,
          record.location.longitude,
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

    // Only evaluated if distance between configured checkpoints is at least 100 meters
    if (checkpointDistance >= 100) {
      const tCurrent = new Date(record.occurredAtDevice).getTime();
      const tPrevious = new Date(previousRecord.occurredAtDevice).getTime();
      const timeDeltaSeconds = (tCurrent - tPrevious) / 1000;

      let speedKmh: number;
      if (timeDeltaSeconds <= 0) {
        speedKmh = Infinity;
      } else {
        speedKmh = (checkpointDistance / timeDeltaSeconds) * 3.6;
      }

      if (speedKmh > site.maxSpeedKmh) {
        flags.push({
          type: 'impossible_time',
          severity: FLAG_SEVERITY.impossible_time,
          reason: 'speed_exceeded',
          details: {
            speedKmh: Number.isFinite(speedKmh) ? Math.round(speedKmh * 100) / 100 : 'infinity',
            maxSpeedKmh: site.maxSpeedKmh,
            distanceMeters: Math.round(checkpointDistance * 100) / 100,
            timeDeltaSeconds,
          },
        });
      }
    }
  }

  return flags;
}

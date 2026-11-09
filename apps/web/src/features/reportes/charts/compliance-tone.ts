import { chartColors, failureFill } from './chart-theme';

/** Bajo este porcentaje, el cumplimiento se marca como falla. */
export const COMPLIANCE_THRESHOLD = 90;

/** ink: lo normal · delay: demoras · failure: fallas (trama diagonal) · muted: fuera del porcentaje. */
export type ChartTone = 'ink' | 'delay' | 'failure' | 'muted';

export const toneFill: Record<ChartTone, string> = {
  ink: chartColors.ink,
  delay: chartColors.delay,
  failure: failureFill,
  muted: chartColors.muted,
};

/** Tono de una barra de porcentaje: falla si no llega al umbral. */
export function percentageTone(value: number | null): ChartTone {
  return value !== null && value < COMPLIANCE_THRESHOLD ? 'failure' : 'ink';
}

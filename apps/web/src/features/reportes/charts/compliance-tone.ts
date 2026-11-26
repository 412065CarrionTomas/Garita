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

/**
 * Tope del eje para cantidades: cuatro tramos redondos que cubren el máximo sin dejar las barras
 * por la mitad (1214 → 1600, 42 → 44).
 */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  let magnitude = 10 ** Math.floor(Math.log10(raw));
  // Tramo chico para su magnitud (10,5 → 20 dejaría media barra vacía): redondear un dígito más fino.
  if (raw / magnitude < 2) magnitude /= 10;
  return Math.ceil(raw / magnitude) * magnitude * 4;
}

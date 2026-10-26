import { FLAG_SEVERITY, type RecordFlagSeverity, type RecordFlagType } from '../marcas/types';
import type { RoundWindowStatus } from './window-status';

export function windowSeverity(
  points: { flags: RecordFlagType[]; invalidated: boolean }[],
  totalPoints: number,
): RecordFlagSeverity | null {
  const marked = points.filter((point) => !point.invalidated && point.flags.length > 0);
  if (marked.some((point) => point.flags.some((flag) => FLAG_SEVERITY[flag] === 'grave')))
    return 'grave';
  if (marked.length > totalPoints / 2) return 'grave';
  if (marked.some((point) => point.flags.some((flag) => FLAG_SEVERITY[flag] === 'media')))
    return 'media';
  return marked.length > 0 ? 'leve' : null;
}

// TODO(HU-17): use this rule when the missed-round notification is implemented.
export function shouldNotifyMissedRound(status: RoundWindowStatus): boolean {
  return status === 'incomplete' || status === 'not_done';
}

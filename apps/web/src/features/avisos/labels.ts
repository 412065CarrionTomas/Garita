import type { NoticeKind, NoticeResolution } from '@garita/shared';

export const noticeLabels: Record<NoticeKind, string> = {
  round_missed: 'Ronda incumplida',
  shift_unsynced: 'Turno sin sincronizar',
  shift_not_started: 'Turno no iniciado',
  shift_closed_early: 'Turno cerrado antes de hora',
  shift_without_guard: 'Turno sin vigilador',
};
export const resolutionLabels: Record<NoticeResolution, string> = {
  data_arrived: 'Llegaron los datos',
  late_start: 'Inicio tardío',
  reassigned: 'Reasignado',
  covered: 'Cubierto',
  guard_assigned: 'Vigilador asignado',
  closed_without_data: 'Cerrado sin datos',
};

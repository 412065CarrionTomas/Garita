import { StatusBadge } from '@/components/status-badge';

export function ScheduleBadges({
  scheduleId,
  individuallyModified,
}: {
  scheduleId?: string | null;
  individuallyModified?: boolean;
}) {
  if (!scheduleId) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="neutral">De programación</StatusBadge>
      {individuallyModified && <StatusBadge tone="info">Modificado individualmente</StatusBadge>}
    </div>
  );
}

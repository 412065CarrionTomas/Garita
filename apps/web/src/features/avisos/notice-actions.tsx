import { useState } from 'react';
import type { z } from 'zod';
import type { noticeSchema } from '@garita/shared';
import { Button } from '@/components/ui/button';
import { ReassignDialog } from '../supervision/reassign-dialog';
import { CloseWithoutDataDialog } from './close-without-data-dialog';

/** Acciones disponibles para cada aviso abierto. */
export function NoticeActions({ notice }: { notice: z.infer<typeof noticeSchema> }) {
  const [closing, setClosing] = useState(false);
  if (notice.status !== 'open') return null;
  const coverageLabel =
    notice.kind === 'shift_not_started'
      ? 'Reasignar turno'
      : notice.kind === 'shift_closed_early'
        ? 'Cubrir el resto'
        : notice.kind === 'shift_without_guard'
          ? 'Asignar vigilador'
          : null;
  if (coverageLabel)
    return (
      <>
        <Button
          variant="outline"
          onClick={() => {
            setClosing(true);
          }}
        >
          {coverageLabel}
        </Button>
        {closing && (
          <ReassignDialog
            shiftId={notice.shiftId}
            endsAt={notice.shift.endsAt}
            minutesToSignal={notice.site.minutesToSignal ?? null}
            covering={notice.kind === 'shift_closed_early'}
            open
            onOpenChange={setClosing}
          />
        )}
      </>
    );
  if (notice.kind !== 'shift_unsynced') return null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setClosing(true);
        }}
      >
        Cerrar sin datos
      </Button>
      {closing && (
        <CloseWithoutDataDialog
          shiftId={notice.shiftId}
          onClose={() => {
            setClosing(false);
          }}
        />
      )}
    </>
  );
}

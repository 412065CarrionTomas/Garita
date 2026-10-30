import { useState } from 'react';
import type { z } from 'zod';
import type { noticeSchema } from '@garita/shared';
import { Button } from '@/components/ui/button';
import { CloseWithoutDataDialog } from './close-without-data-dialog';

/** Actions by kind; HU-35 adds coverage actions here. */
export function NoticeActions({ notice }: { notice: z.infer<typeof noticeSchema> }) {
  const [closing, setClosing] = useState(false);
  if (notice.kind !== 'shift_unsynced' || notice.status !== 'open') return null;
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

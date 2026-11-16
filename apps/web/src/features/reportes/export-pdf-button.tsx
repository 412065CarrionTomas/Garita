import { useId, useState } from 'react';
import { isReportExportPeriodAllowed, REPORT_EXPORT_PERIOD_MESSAGE } from '@garita/shared';
import { apiDownload } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export function ExportPdfButton({
  endpoint,
  filters,
  disabled = false,
}: {
  endpoint: '/reportes/rondas/pdf' | '/reportes/incidentes/pdf' | '/portal/reporte/pdf';
  filters: Record<string, string | undefined>;
  disabled?: boolean;
}) {
  const statusId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tooLong =
    filters.desde && filters.hasta && !isReportExportPeriodAllowed(filters.desde, filters.hasta);
  const download = async () => {
    if (tooLong) {
      setMessage(REPORT_EXPORT_PERIOD_MESSAGE);
      return;
    }
    setBusy(true);
    setMessage('Generando el PDF…');
    try {
      const query = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      const blob = await apiDownload(`${endpoint}?${query.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `garita-${endpoint.includes('rondas') ? 'cumplimiento' : endpoint.includes('incidentes') ? 'incidentes' : 'portal'}-${filters.desde ?? ''}-${filters.hasta ?? ''}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('El PDF está listo para descargar.');
    } catch {
      setMessage('No pudimos generar el PDF. Revisá los filtros o intentá nuevamente.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        aria-busy={busy}
        aria-describedby={statusId}
        onClick={() => void download()}
      >
        {busy ? 'Generando el PDF…' : 'Exportar a PDF'}
      </Button>
      <p id={statusId} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {tooLong ? REPORT_EXPORT_PERIOD_MESSAGE : message}
      </p>
    </div>
  );
}

import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { isReportExportPeriodAllowed, REPORT_EXPORT_PERIOD_MESSAGE } from '@garita/shared';
import { apiDownload } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FloatingNotice } from '@/components/floating-notice';
import { useFloatingNotice } from '@/lib/use-floating-notice';

export function ExportPdfButton({
  endpoint,
  filters,
  disabled = false,
  iconOnly = false,
}: {
  endpoint: '/reportes/rondas/pdf' | '/reportes/incidentes/pdf' | '/portal/reporte/pdf';
  filters: Record<string, string | undefined>;
  disabled?: boolean;
  /** Solo el ícono (con nombre accesible y tooltip), para barras de filtros. */
  iconOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // Avance y éxito solo para lector de pantalla; un problema, en aviso flotante: el botón no se mueve.
  const [status, setStatus] = useState('');
  const { notice, notify, close } = useFloatingNotice();
  const tooLong =
    filters.desde && filters.hasta && !isReportExportPeriodAllowed(filters.desde, filters.hasta);
  const download = async () => {
    if (tooLong) {
      notify(REPORT_EXPORT_PERIOD_MESSAGE, 'danger');
      return;
    }
    setBusy(true);
    setStatus('Generando el PDF…');
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
      setStatus('El PDF está listo para descargar.');
    } catch {
      setStatus('');
      notify('No pudimos generar el PDF. Revisá los filtros o intentá nuevamente.', 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? 'icon-lg' : 'default'}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={iconOnly ? 'Exportar a PDF' : undefined}
        title={iconOnly ? 'Exportar a PDF' : undefined}
        onClick={() => void download()}
      >
        {iconOnly ? <FileDown aria-hidden="true" /> : 'Exportar a PDF'}
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {notice && (
        <FloatingNotice key={notice.id} text={notice.text} tone={notice.tone} onClose={close} />
      )}
    </>
  );
}

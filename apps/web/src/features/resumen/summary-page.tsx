import { adminSummaryCatalog } from '@garita/shared';
import { PageHeader } from '@/components/page-header';
import { ErrorBoundary } from '@/components/error-boundary';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { LayoutGrid } from '@/lib/layout-grid/layout-grid';
import { useViewLayout } from '@/lib/layout-grid/use-view-layout';
import { widgetTitle } from './summary-rows';
import { summaryWidget } from './widgets/registry';
import { WidgetFrame } from './widget-frame';

const today = () =>
  new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Primera pantalla del administrador: el estado de la empresa en bloques que puede acomodar. */
export function SummaryPage() {
  const { items, failed } = useViewLayout(adminSummaryCatalog);
  return (
    <section aria-labelledby="summary-title" className="space-y-6">
      <PageHeader
        id="summary-title"
        title="Resumen de la empresa"
        description={`${today().replace(/^./, (first) => first.toUpperCase())} · lo pendiente ahora y cómo viene el servicio.`}
      />
      {failed && (
        <Alert variant="neutral" role="status">
          No pudimos cargar tu diseño guardado: se muestra el diseño por defecto.
        </Alert>
      )}
      {items ? (
        <LayoutGrid
          catalog={adminSummaryCatalog}
          items={items}
          aria-label="Bloques del resumen"
          renderItem={(item) => {
            const Widget = summaryWidget(item.id);
            const title = widgetTitle(item.id);
            if (!Widget) return null;
            // Un bloque que falla al dibujarse no tira abajo el resto del resumen.
            return (
              <ErrorBoundary
                fallback={
                  <WidgetFrame title={title}>
                    <p role="alert" className="p-5 text-sm">
                      No pudimos mostrar este bloque. Recargá la página para intentar de nuevo.
                    </p>
                  </WidgetFrame>
                }
              >
                <Widget item={item} />
              </ErrorBoundary>
            );
          }}
        />
      ) : (
        <div role="status" aria-label="Cargando el resumen" className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-40 lg:col-span-3" />
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      )}
    </section>
  );
}

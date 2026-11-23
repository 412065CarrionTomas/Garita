import { useMemo } from 'react';
import { adminSummaryCatalog, readingOrder } from '@garita/shared';
import { PageHeader } from '@/components/page-header';
import { ErrorBoundary } from '@/components/error-boundary';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { BlocksPanel } from '@/lib/layout-grid/blocks-panel';
import { EditToolbar } from '@/lib/layout-grid/edit-toolbar';
import { LayoutGrid } from '@/lib/layout-grid/layout-grid';
import { useGridColumns } from '@/lib/layout-grid/use-grid-columns';
import { useViewLayoutEditor } from '@/lib/layout-grid/use-view-layout-editor';
import { describeSummaryBlock } from './block-descriptions';
import { widgetTitle } from './summary-rows';
import { summaryWidget } from './widgets/registry';
import { WidgetFrame } from './widget-frame';

const today = () => {
  const text = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Primera pantalla del administrador: el estado de la empresa en bloques que puede acomodar. */
export function SummaryPage() {
  const editor = useViewLayoutEditor(adminSummaryCatalog);
  const { editable } = useGridColumns(adminSummaryCatalog.columns);
  const { state, items } = editor;
  const base = state.mode === 'edit' ? state.base : undefined;
  const editOrder = useMemo(
    () => (base ? readingOrder(base).flatMap((index) => base[index]?.id ?? []) : []),
    [base],
  );
  return (
    <section aria-labelledby="summary-title" className="space-y-6">
      <PageHeader
        id="summary-title"
        title="Resumen de la empresa"
        description={`${today()} · lo pendiente ahora y cómo viene el servicio.`}
        actions={
          <EditToolbar editor={editor} editable={editable}>
            <BlocksPanel editor={editor} describe={describeSummaryBlock} />
          </EditToolbar>
        }
      />
      {editor.loadFailed && !editor.editing && (
        <Alert variant="neutral" role="status">
          No pudimos cargar tu diseño guardado: se muestra el diseño por defecto.
        </Alert>
      )}
      {editor.editing && (
        <Alert variant="neutral" role="status">
          {editable
            ? 'Editando el diseño: arrastrá el asa de arriba para mover un bloque y la de abajo para cambiar su tamaño. Nada se guarda hasta que toques Guardar diseño.'
            : 'Ampliá la ventana (1024 px o más) para seguir moviendo bloques. Podés guardar o cancelar igual.'}
        </Alert>
      )}
      {editor.conflict && (
        <Alert variant="destructive" role="alert" className="space-y-3">
          <p>
            Tu diseño cambió desde otra pestaña o dispositivo mientras lo editabas. ¿Cuál querés
            conservar?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void editor.keepMine()}>
              Seguir con mis cambios
            </Button>
            <Button variant="outline" onClick={() => void editor.takeTheirs()}>
              Ver el diseño guardado
            </Button>
          </div>
        </Alert>
      )}
      {editor.saveFailed && (
        <Alert variant="destructive" role="alert">
          No pudimos guardar el diseño. Revisá la conexión e intentá de nuevo; tus cambios siguen
          acá.
        </Alert>
      )}
      {items?.every((item) => item.hidden) && (
        <EmptyState
          title="Todos los bloques están ocultos"
          description={
            editor.editing
              ? 'Mostralos desde Bloques, o restablecé el diseño.'
              : 'Tocá Editar diseño y mostralos desde Bloques.'
          }
        />
      )}
      {items ? (
        <LayoutGrid
          catalog={adminSummaryCatalog}
          items={items}
          aria-label="Bloques del resumen"
          edit={
            editor.editing
              ? { dispatch: editor.dispatch, titleOf: widgetTitle, order: editOrder }
              : undefined
          }
          renderItem={(item) => {
            const Widget = summaryWidget(item.id);
            if (!Widget) return null;
            // Un bloque que falla al dibujarse no tira abajo el resto del resumen.
            return (
              <ErrorBoundary
                fallback={
                  <WidgetFrame title={widgetTitle(item.id)}>
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

/* eslint react-refresh/only-export-components: off */
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { RowsSkeleton, useIncidentPendingCount } from './incident-ui';
import { IncidentsTable } from './incidents-table';
import { TriageView } from './triage-view';

export { IncidentDetailPage } from './incident-detail';
export { useIncidentPendingCount } from './incident-ui';

type View = 'por-clasificar' | 'todos';

/**
 * Incidentes en una sola pantalla: la bandeja para clasificar lo pendiente y el archivo para
 * buscar. Si hay pendientes se abre en la bandeja.
 */
export function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const pending = useIncidentPendingCount(true);
  const count = pending.data?.count ?? 0;
  const requested = params.get('vista');
  // Sin vista en la URL se elige una sola vez, con el primer conteo: el sondeo de 30 s no cambia
  // de pestaña a quien está trabajando.
  const [initialView, setInitialView] = useState<View | null>(null);
  if (initialView === null && pending.data)
    setInitialView(pending.data.count > 0 ? 'por-clasificar' : 'todos');
  const view: View | null =
    requested === 'todos' || requested === 'por-clasificar' ? requested : initialView;
  return (
    <main className="space-y-4">
      <PageHeader
        title="Incidentes"
        description={
          view === 'por-clasificar'
            ? 'Decidí quién ve cada reporte, qué gravedad tiene y si requiere seguimiento.'
            : 'Todo lo reportado por los vigiladores, para buscar y dar seguimiento.'
        }
        actions={
          <SegmentedFilter<View>
            ariaLabel="Vista"
            className="[&>button]:h-10 [&>button]:text-base"
            options={[
              {
                value: 'por-clasificar',
                label: count ? `Por clasificar (${String(count)})` : 'Por clasificar',
              },
              { value: 'todos', label: 'Todos' },
            ]}
            value={view ?? 'por-clasificar'}
            onChange={(vista) => {
              setParams({ vista }, { replace: true });
            }}
          />
        }
      />
      {view === null ? (
        <RowsSkeleton label="Cargando incidentes…" />
      ) : view === 'por-clasificar' ? (
        <TriageView />
      ) : (
        <IncidentsTable />
      )}
    </main>
  );
}

/** La cola vieja ahora es la vista "Por clasificar". */
export function IncidentsQueueRedirect() {
  return <Navigate to="/incidentes?vista=por-clasificar" replace />;
}

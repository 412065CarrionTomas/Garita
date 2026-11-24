import { lazy, Suspense } from 'react';
import type { RouteEditorProps } from './route-editor-view';

export type {
  RouteEditorPoint,
  RouteEditorProps,
  RouteSelection,
  RouteTool,
} from './route-editor-view';

const View = lazy(() =>
  import('./route-editor-view').then((m) => ({ default: m.RouteEditorView })),
);

/** Mapa del editor del recorrido, cargado en diferido para que MapLibre no entre al bundle inicial. */
export function RouteEditor(props: RouteEditorProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm">
          Cargando mapa del recorrido…
        </p>
      }
    >
      <View {...props} />
    </Suspense>
  );
}

import { ROUTE_LIMITS, type RouteInput, type RouteMode } from '@garita/shared';
import { TriangleAlert } from 'lucide-react';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MODE_LABEL } from '../mapa/route-features';
import { ModeIcon } from '../mapa/route-legend';
import {
  FAILURE_TEXT,
  formatMeters,
  legLabel,
  partLabel,
  STATE_LABEL,
  type PartInfo,
} from './route-draft';
import type { RouteSelection } from './route-editor';

const MODES: { value: RouteMode; label: string }[] = [
  { value: 'streets', label: 'Por calles' },
  { value: 'manual', label: 'Trazo libre' },
];

const MODE_HINT: Record<RouteMode, string> = {
  streets: 'Sigue las calles. Se calcula con «Calcular por calles».',
  manual: 'Rectas entre sus puntos. No se calcula.',
};

/** Lo que hace un punto de guía según el modo de su parte. */
const GUIDE_HINT: Record<RouteMode, string> = {
  streets: 'La ruta pasa por este punto.',
  manual: 'La línea dobla en este punto.',
};

export interface RouteInspectorProps {
  route: RouteInput;
  parts: PartInfo[];
  selection: RouteSelection | null;
  meters: number[];
  /** Tramos cuyos puntos se movieron más de 5 m desde que se guardó el recorrido. */
  stale: Set<number>;
  pointName: (id: string) => string;
  pointOrder: (id: string) => number;
  onSetMode: (l: number, s: number, mode: RouteMode) => void;
  onSplit: (l: number, s: number, i: number) => void;
  onMerge: (l: number, k: number) => void;
  onRemoveVia: (l: number, s: number, i: number) => void;
  onRemoveWaypoint: (l: number, k: number) => void;
  onRemovePoint: (id: string) => void;
}

function Switch({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onChange: () => void;
}) {
  return (
    <label className={cn('flex items-start gap-2', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        role="switch"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** Barra de abajo del mapa: muestra y edita solo lo elegido. */
export function RouteInspector(props: RouteInspectorProps) {
  const { route, parts, selection } = props;
  if (route.legs.length === 0)
    return <p className="text-muted-foreground">Elegí dos o más puntos para armar el recorrido.</p>;
  if (!selection)
    return (
      <p className="text-muted-foreground">
        Tocá una línea para elegir su parte. En la parte elegida, un clic sobre la línea suma un
        punto de guía. Los puntos se arrastran; clic derecho los elimina.
      </p>
    );

  if (selection.kind === 'point') {
    const order = props.pointOrder(selection.id);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">
          {order >= 0 ? `Punto de control ${String(order + 1)} · ` : ''}
          {props.pointName(selection.id)}
        </span>
        <span className="text-muted-foreground">
          {order >= 0
            ? 'Se escanea en su orden, en cada ventana de la ronda. Moverlo más de 5 m deja sus tramos sin calcular.'
            : 'No está en esta ronda. Con «Sumar puntos de control», tocalo para sumarlo al final.'}
        </span>
        {order >= 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              props.onRemovePoint(selection.id);
            }}
          >
            Quitar de la ronda
          </Button>
        )}
      </div>
    );
  }

  if (selection.kind === 'waypoint') {
    const { l, k } = selection;
    const leg = route.legs[l];
    const from = leg?.sections[k]?.mode ?? 'streets';
    const to = leg?.sections[k + 1]?.mode ?? 'streets';
    const merged =
      (leg?.sections[k]?.via.length ?? 0) + (leg?.sections[k + 1]?.via.length ?? 0) + 1;
    const tooMany = merged > ROUTE_LIMITS.viaPerSection;
    return (
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <span>
          <span className="block font-medium">
            Cambio de modo · Tramo {legLabel(l, route.legs.length, route.closed)}
          </span>
          <span className="text-muted-foreground">
            De {MODE_LABEL[from]} a {MODE_LABEL[to]}. No se escanea ni se controla.
          </span>
        </span>
        <Switch
          checked
          disabled={tooMany}
          label="Cambiar de modo en este punto"
          hint={
            tooMany
              ? `Las dos partes juntas pasarían los ${String(ROUTE_LIMITS.viaPerSection)} puntos de guía.`
              : `Si lo desactivás, las dos partes se unen como ${MODE_LABEL[from]}.`
          }
          onChange={() => {
            props.onMerge(l, k);
          }}
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            props.onRemoveWaypoint(l, k);
          }}
        >
          Eliminar punto
        </Button>
      </div>
    );
  }

  const { l, s } = selection;
  const leg = route.legs[l];
  const section = leg?.sections[s];
  const info = parts.find((p) => p.l === l && p.s === s);
  if (!leg || !section || !info) return null;
  const label = partLabel(route, l, s);
  const fullLeg = leg.waypoints.length >= ROUTE_LIMITS.waypointsPerLeg;

  if (selection.kind === 'via') {
    const { i } = selection;
    return (
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <span>
          <span className="block font-medium">
            Punto de guía {i + 1} · {label}
          </span>
          <span className="text-muted-foreground">
            {GUIDE_HINT[section.mode]} No se escanea ni se controla.
          </span>
        </span>
        <Switch
          checked={false}
          disabled={fullLeg}
          label="Cambiar de modo en este punto"
          hint={
            fullLeg
              ? `El tramo ya tiene ${String(ROUTE_LIMITS.waypointsPerLeg)} cambios de modo.`
              : `Desde acá la línea pasa a ${MODE_LABEL[section.mode === 'streets' ? 'manual' : 'streets']}.`
          }
          onChange={() => {
            props.onSplit(l, s, i);
          }}
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            props.onRemoveVia(l, s, i);
          }}
        >
          Eliminar punto
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
      <span>
        <span className="block font-medium">
          {label} · {formatMeters(props.meters[l] ?? 0)}
        </span>
        <span
          className={cn(
            'flex items-center gap-1',
            info.state === 'failed' || info.state === 'straight'
              ? 'text-warning'
              : 'text-muted-foreground',
          )}
        >
          {(info.state === 'failed' || info.state === 'straight') && (
            <TriangleAlert aria-hidden="true" className="size-3.5" />
          )}
          {STATE_LABEL[info.state]}
          {info.failure ? `: ${FAILURE_TEXT[info.failure]}` : '.'}
          {props.stale.has(l) && ' Se movió un punto de control desde que se trazó.'}
        </span>
      </span>
      <div className="grid gap-1">
        <SegmentedFilter
          ariaLabel={`Modo de ${label}`}
          options={MODES}
          value={section.mode}
          onChange={(mode) => {
            props.onSetMode(l, s, mode);
          }}
        />
        <span className="flex items-center gap-1 text-muted-foreground">
          <ModeIcon mode={section.mode} />
          {MODE_HINT[section.mode]}
        </span>
      </div>
      <span className="text-muted-foreground tabular-nums">
        Puntos de guía {section.via.length} de {ROUTE_LIMITS.viaPerSection} · cambios de modo del
        tramo {leg.waypoints.length} de {ROUTE_LIMITS.waypointsPerLeg}
      </span>
    </div>
  );
}

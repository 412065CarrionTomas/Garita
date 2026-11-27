import { ROUTE_LIMITS, type RouteInput } from '@garita/shared';
import { ChevronRight, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MODE_LABEL } from '../mapa/route-features';
import { ModeIcon } from '../mapa/route-legend';
import {
  STATE_LABEL,
  formatMeters,
  legLabel,
  otherMode,
  partKey,
  partLabel,
  type PartInfo,
} from './route-draft';
import type { RouteSelection } from './route-editor';

/**
 * Pestaña Tramos: cada tramo con sus partes; elegir una acá la elige en el mapa. Cada parte suma
 * puntos de guía con «+» y los muestra numerados al desplegarla; la última del tramo además suma
 * una parte del otro modo hasta el destino.
 */
export function LegsList({
  route,
  parts,
  meters,
  selection,
  expanded,
  collapsed,
  onToggleLeg,
  onToggle,
  onSelect,
  onAddGuide,
  onAddModeChange,
  onRemoveGuide,
}: {
  route: RouteInput;
  parts: PartInfo[];
  meters: number[];
  selection: RouteSelection | null;
  /** Partes desplegadas (clave `partKey`). */
  expanded: ReadonlySet<string>;
  /** Tramos plegados (índice). */
  collapsed: ReadonlySet<number>;
  onToggleLeg: (l: number) => void;
  onToggle: (l: number, s: number) => void;
  onSelect: (selection: RouteSelection) => void;
  onAddGuide: (l: number, s: number) => void;
  onAddModeChange: (l: number, s: number) => void;
  onRemoveGuide: (l: number, s: number, i: number) => void;
}) {
  if (route.legs.length === 0)
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Sumá dos o más puntos en la pestaña Orden para armar los tramos.
      </p>
    );
  const chosen =
    selection?.kind === 'part' || selection?.kind === 'via'
      ? partKey(selection.l, selection.s)
      : null;
  return (
    <ol aria-label="Tramos del recorrido" className="grid gap-3 p-3">
      {route.legs.map((leg, l) => (
        <li key={`leg-${String(l)}`}>
          <h5 className="font-cond text-base font-semibold tracking-wider text-foreground uppercase">
            <button
              type="button"
              aria-expanded={!collapsed.has(l)}
              onClick={() => {
                onToggleLeg(l);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xs text-left hover:text-foreground"
            >
              <span className="flex items-center gap-1">
                <ChevronRight
                  aria-hidden="true"
                  className={cn('size-4 transition-transform', !collapsed.has(l) && 'rotate-90')}
                />
                Tramo {legLabel(l, route.legs.length, route.closed)}
                {collapsed.has(l) &&
                  leg.sections.length > 1 &&
                  ` · ${String(leg.sections.length)} partes`}
              </span>
              <span className="tabular-nums">{formatMeters(meters[l] ?? 0)}</span>
            </button>
          </h5>
          <ul hidden={collapsed.has(l)} className="mt-1 grid gap-1.5">
            {leg.sections.map((section, s) => {
              const key = partKey(l, s);
              const info = parts.find((p) => p.l === l && p.s === s);
              const warn = info?.state === 'failed' || info?.state === 'straight';
              const pressed = chosen === key;
              const open = expanded.has(key) && section.via.length > 0;
              const label = partLabel(route, l, s);
              const other = otherMode(section.mode);
              // Solo la última parte: antes de otra parte, sumar el otro modo sería correr ese cambio.
              const last = s === leg.sections.length - 1;
              return (
                <li
                  key={`part-${String(s)}`}
                  className={cn(
                    'rounded-sm border-[1.5px] border-foreground',
                    section.mode === 'manual' && 'border-dashed',
                    pressed && 'outline-2 outline-offset-1 outline-foreground',
                  )}
                >
                  <div className={cn('flex', pressed && 'bg-muted')}>
                    <span className="flex w-7 shrink-0 flex-col items-center pt-2">
                      <ModeIcon mode={section.mode} />
                      {section.via.length > 0 && (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? 'Ocultar' : 'Ver'} puntos de guía de ${label}`}
                          title={open ? 'Ocultar puntos de guía' : 'Ver puntos de guía'}
                          onClick={() => {
                            onToggle(l, s);
                          }}
                          className="mt-0.5 grid size-5 place-items-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                          />
                        </button>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => {
                        onSelect({ kind: 'part', l, s });
                      }}
                      className="min-w-0 flex-1 py-1.5 pr-1 text-left hover:bg-muted"
                    >
                      <span className="block font-medium">
                        {MODE_LABEL[section.mode]}
                        {leg.sections.length > 1 &&
                          ` · Parte ${String(s + 1)} de ${String(leg.sections.length)}`}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          warn ? 'text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {warn && <TriangleAlert aria-hidden="true" className="size-3" />}
                        {info ? STATE_LABEL[info.state] : ''}
                        {section.via.length > 0 &&
                          ` · ${String(section.via.length)} ${section.via.length === 1 ? 'punto' : 'puntos'} de guía`}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-0.5 pr-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Sumar punto de guía a ${label}`}
                        title="Sumar punto de guía"
                        disabled={section.via.length >= ROUTE_LIMITS.viaPerSection}
                        onClick={() => {
                          onAddGuide(l, s);
                        }}
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                      {last && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Sumar ${MODE_LABEL[other]} al final de ${label}`}
                          title={`Sumar ${MODE_LABEL[other]} hasta el punto siguiente`}
                          disabled={leg.waypoints.length >= ROUTE_LIMITS.waypointsPerLeg}
                          onClick={() => {
                            onAddModeChange(l, s);
                          }}
                        >
                          <Plus aria-hidden="true" />
                          <ModeIcon mode={other} className="size-3" />
                        </Button>
                      )}
                    </span>
                  </div>
                  {open && (
                    <ol
                      aria-label={`Puntos de guía de ${label}`}
                      className="border-t border-border py-0.5"
                    >
                      {section.via.map((_, i) => {
                        const picked =
                          selection?.kind === 'via' &&
                          selection.l === l &&
                          selection.s === s &&
                          selection.i === i;
                        return (
                          <li
                            key={`via-${String(i)}`}
                            className={cn('flex items-center pr-1 pl-7', picked && 'bg-muted')}
                          >
                            <button
                              type="button"
                              aria-pressed={picked}
                              onClick={() => {
                                onSelect({ kind: 'via', l, s, i });
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
                            >
                              <span className="font-cond w-5 text-right font-semibold text-foreground tabular-nums">
                                {i + 1}
                              </span>
                              Punto de guía
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Eliminar punto de guía ${String(i + 1)} de ${label}`}
                              title="Eliminar punto de guía"
                              onClick={() => {
                                onRemoveGuide(l, s, i);
                              }}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

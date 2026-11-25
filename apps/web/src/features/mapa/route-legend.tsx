import type { RouteMode } from '@garita/shared';
import { PenLine, Route } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SectionKind } from './route-features';

/** Ícono del modo de una parte: va en la lista, en las etiquetas y en los cambios de modo. */
export function ModeIcon({ mode, className }: { mode: RouteMode; className?: string }) {
  const Icon = mode === 'streets' ? Route : PenLine;
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />;
}

/** Cambio de modo: rectángulo partido, a la izquierda el modo anterior y a la derecha el siguiente. */
export function ModeChangeMark({ from, to }: { from: RouteMode; to: RouteMode }) {
  return (
    <span className="flex divide-x-[1.5px] divide-foreground border-[1.5px] border-foreground bg-card text-foreground">
      {[from, to].map((mode, i) => (
        <span key={i} className="grid size-4 place-items-center">
          <ModeIcon mode={mode} className="size-3" />
        </span>
      ))}
    </span>
  );
}

/** Punto de guía: chico y hueco. */
export function GuideMark() {
  return <span className="block size-3 rounded-full border-2 border-foreground bg-card" />;
}

/** Muestra de línea con el mismo patrón que en el mapa. */
export function LineSwatch({ kind }: { kind: SectionKind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 8" className="h-2 w-7 shrink-0">
      <line
        x1="2"
        y1="4"
        x2="26"
        y2="4"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-foreground"
        strokeDasharray={kind === 'manual' ? '8 4' : kind === 'fallback' ? '0.5 5' : undefined}
      />
    </svg>
  );
}

const LINES: { kind: SectionKind; label: string }[] = [
  { kind: 'streets', label: 'Por calles' },
  { kind: 'manual', label: 'Trazo libre' },
  { kind: 'fallback', label: 'Sin calcular o falló (recta)' },
];

/**
 * Leyenda del recorrido, plegable, en la esquina del mapa. Los símbolos son los mismos del mapa.
 * Con `markers` explica también los marcadores del editor.
 */
export function RouteLegend({
  kinds,
  markers = false,
}: {
  kinds: SectionKind[];
  markers?: boolean;
}) {
  const lines = LINES.filter(({ kind }) => kinds.includes(kind));
  if (!lines.length && !markers) return null;
  return (
    <details
      open
      className="absolute bottom-3.5 left-3.5 z-10 max-w-[calc(100%-1.75rem)] rounded-sm border border-border bg-card/90 px-2 py-1 text-xs text-foreground"
    >
      <summary className="t-label cursor-pointer">Leyenda</summary>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {markers && (
          <>
            <li className="flex items-center gap-1.5">
              <span className="font-cond grid size-4 place-items-center border-2 border-foreground bg-card text-xs font-semibold">
                1
              </span>
              Punto de control: se escanea
            </li>
            <li className="flex items-center gap-1.5">
              <GuideMark />
              Punto de guía
            </li>
            <li className="flex items-center gap-1.5">
              <ModeChangeMark from="streets" to="manual" />
              Cambio de modo
            </li>
          </>
        )}
        {lines.map(({ kind, label }) => (
          <li key={kind} className="flex items-center gap-1.5">
            <LineSwatch kind={kind} />
            {label}
          </li>
        ))}
      </ul>
      {markers && (
        <p className="mt-1 text-muted-foreground">
          El recorrido es una guía: solo se controlan los puntos de control.
        </p>
      )}
    </details>
  );
}

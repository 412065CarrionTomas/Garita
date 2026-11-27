import type { RouteMode } from '@garita/shared';
import { ChevronDown, PenLine, Route } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** Punto del predio que no está en la ronda: chico, tenue y sin número. */
export function OutsideMark() {
  return <span className="block size-3 border-2 border-muted-foreground bg-card opacity-60" />;
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

function Row({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="grid w-7 shrink-0 place-items-center">{mark}</span>
      {children}
    </li>
  );
}

/**
 * Leyenda del recorrido, plegable, arriba a la izquierda debajo de Mapa/Satélite.
 * Los símbolos son los mismos del mapa. Con `markers` explica también los marcadores del editor;
 * con `checkpoints`, solo el punto de control (vista previa); con `outside`, los puntos del predio
 * que no están en la ronda.
 */
export function RouteLegend({
  kinds,
  markers = false,
  checkpoints = false,
  outside = false,
}: {
  kinds: SectionKind[];
  markers?: boolean;
  checkpoints?: boolean;
  outside?: boolean;
}) {
  const lines = LINES.filter(({ kind }) => kinds.includes(kind));
  const points = markers || checkpoints || outside;
  if (!lines.length && !points) return null;
  return (
    <details
      open
      className="group absolute top-15 left-3.5 z-10 w-max max-w-[min(16rem,calc(100%-1.75rem))] rounded-md border-[1.5px] border-border bg-card/95 text-xs text-foreground shadow-sm"
    >
      <summary className="t-label flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        Leyenda
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-2 border-t border-border px-2.5 pt-2 pb-2.5">
        {points && (
          <ul className="grid gap-1.5" aria-label="Marcadores">
            {(markers || checkpoints) && (
              <Row
                mark={
                  <span className="font-cond grid size-4 place-items-center border-2 border-foreground bg-card text-xs font-semibold">
                    1
                  </span>
                }
              >
                Punto de control: se escanea
              </Row>
            )}
            {outside && <Row mark={<OutsideMark />}>Punto del predio fuera de la ronda</Row>}
            {markers && (
              <>
                <Row mark={<GuideMark />}>Punto de guía: solo da forma</Row>
                <Row mark={<ModeChangeMark from="streets" to="manual" />}>Cambio de modo</Row>
              </>
            )}
          </ul>
        )}
        {lines.length > 0 && (
          <ul
            className={cn('grid gap-1.5', points && 'border-t border-border pt-2')}
            aria-label="Líneas"
          >
            {lines.map(({ kind, label }) => (
              <Row key={kind} mark={<LineSwatch kind={kind} />}>
                {label}
              </Row>
            ))}
          </ul>
        )}
        {markers && (
          <p className="text-muted-foreground">
            El recorrido es una guía: solo se controlan los puntos de control.
          </p>
        )}
      </div>
    </details>
  );
}

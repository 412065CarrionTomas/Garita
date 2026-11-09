import type { ReactNode } from 'react';

/**
 * Pantalla partida de supervisión: panel a la izquierda (lista o foja) y mapa a la derecha.
 * Ocupa todo el alto bajo la barra (52 px) y se apila bajo 1180 px. Compensa el padding del shell.
 */
export function LiveLayout({
  panel,
  map,
  labelledBy,
}: {
  panel: ReactNode;
  map: ReactNode;
  labelledBy: string;
}) {
  return (
    <div className="-mx-5 -my-6 grid sm:-mx-6 lg:-mx-7 min-[1180px]:h-[calc(100svh-52px)] min-[1180px]:grid-cols-[clamp(640px,28vw,900px)_minmax(0,1fr)]">
      <section
        aria-labelledby={labelledBy}
        className="flex min-h-0 min-w-0 flex-col border-r border-input bg-card"
      >
        {panel}
      </section>
      <div className="relative h-[55svh] min-h-0 overflow-hidden bg-muted min-[1180px]:h-auto">
        {map}
      </div>
    </div>
  );
}

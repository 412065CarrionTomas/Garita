import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Qué hace cada control del editor que no se explica solo con su nombre. */
const HELP: { title: string; items: [string, string][] }[] = [
  {
    title: 'Horario',
    items: [
      ['Franja', 'Horas del día en que la ronda está vigente.'],
      ['Frecuencia', 'Cada cuántos minutos empieza una vuelta nueva dentro de la franja.'],
      [
        'Ventana',
        'Cada período de la frecuencia. En cada ventana hay que pasar por todos los puntos.',
      ],
      [
        'Gracia',
        'Minutos después del fin de una ventana en que un registro todavía cuenta para ella, marcado como tarde.',
      ],
    ],
  },
  {
    title: 'Orden',
    items: [
      ['Compartido', 'El punto también forma parte de otra ronda del predio.'],
      ['Fuera de la ronda', 'Puntos del predio que esta ronda no incluye.'],
    ],
  },
  {
    title: 'Recorrido',
    items: [
      ['Tramo', 'El camino de un punto de control al siguiente.'],
      ['Parte', 'Un pedazo del tramo con un solo modo: por calles o trazo libre.'],
      [
        'Punto de guía',
        'Da forma a la línea de su parte. Por calles, la ruta pasa por ahí; en trazo libre, la línea dobla ahí. No se escanea.',
      ],
      ['Cambio de modo', 'Punto donde termina una parte y empieza otra con el otro modo.'],
      ['Por calles', 'La línea sigue las calles; se calcula con «Calcular por calles».'],
      ['Trazo libre', 'Rectas entre sus puntos. No se calcula.'],
    ],
  },
  {
    title: 'Herramientas del mapa',
    items: [
      [
        'Seleccionar',
        'Tocá una línea para elegir su parte; sobre la parte elegida, un clic suma un punto de guía. Los puntos se arrastran y el clic derecho los elimina.',
      ],
      [
        'Sumar puntos de control',
        'Tocá los puntos del predio en el orden en que se recorren: se suman al final. Tocar el último lo saca.',
      ],
      ['Volver al inicio', 'Agrega un último tramo del último punto al primero.'],
      [
        'Calcular por calles',
        'Pide al servicio de rutas solo las partes por calles sin calcular. Hasta calcularlas se ven como línea de puntos recta.',
      ],
    ],
  },
];

export function EditorHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="self-center text-muted-foreground"
          aria-label="Ayuda del editor de rondas"
          title="Ayuda"
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">Cómo se arma una ronda</DialogTitle>
        <DialogDescription className="sr-only">Qué hace cada control del editor.</DialogDescription>
        {HELP.map((group) => (
          <section key={group.title} className="mt-4">
            <h4 className="t-label">{group.title}</h4>
            <dl className="mt-1 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
              {group.items.map(([term, text]) => (
                <div key={term} className="contents">
                  <dt className="font-semibold">{term}</dt>
                  <dd className="text-muted-foreground">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

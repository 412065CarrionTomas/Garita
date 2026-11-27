import { z } from 'zod';
import {
  adminSummaryCatalog,
  defineViewCatalog,
  validateLayout,
  viewLayoutSchema,
  type LayoutItem,
} from '@garita/shared';
import {
  keyboardStep,
  moveItem,
  overlappingIds,
  resizeItem,
  sameLayout,
  scaleLayout,
  setHidden,
  setPresentation,
  setSettings,
  stepItem,
  stepSize,
  type Direction,
} from './engine';

const widget = {
  title: 'Bloque',
  size: {
    min: { w: 1, h: 1 },
    max: { w: 4, h: 6 },
    default: { w: 2, h: 2 },
    minByPresentation: { bars: { w: 2, h: 2 } },
  },
  presentations: ['table', 'bars'] as const,
  settings: z.object({ period: z.enum(['7d', '30d']).default('30d') }),
};
/*
 * Grilla de 4 columnas:
 *   a a b b      fila 0-1
 *   c c c c      fila 2-3
 *   d d . .      fila 4
 */
const catalog = defineViewCatalog({
  key: 'admin-summary',
  version: 1,
  columns: 4,
  roles: ['admin'],
  favoriteTypes: [],
  widgets: {
    a: widget,
    b: widget,
    c: { ...widget, size: { ...widget.size, default: { w: 4, h: 2 } } },
    d: { ...widget, size: { ...widget.size, default: { w: 2, h: 1 } } },
  },
  defaultLayout: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 2, y: 0 },
    { id: 'c', x: 0, y: 2 },
    { id: 'd', x: 0, y: 4 },
  ],
});
// Congelado: si el motor modificara lo recibido, el test fallaría.
const start = (): readonly LayoutItem[] =>
  deepFreeze(
    catalog.defaultLayout.items.map((item) => ({ ...item, settings: { ...item.settings } })),
  );
const at = (items: readonly LayoutItem[]) =>
  Object.fromEntries(items.map((item) => [item.id, [item.x, item.y, item.w, item.h]]));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('moveItem', () => {
  it('devuelve la misma referencia si nada cambia', () => {
    const items = start();
    expect(moveItem(catalog, items, 'a', { x: 0, y: 0 })).toBe(items);
    expect(moveItem(catalog, items, 'nadie', { x: 1, y: 1 })).toBe(items);
  });

  it('queda donde se suelta, aunque deje un hueco, y nadie más se mueve', () => {
    expect(at(moveItem(catalog, start(), 'd', { x: 2, y: 7 }))).toEqual({
      a: [0, 0, 2, 2],
      b: [2, 0, 2, 2],
      c: [0, 2, 4, 2],
      d: [2, 7, 2, 1],
    });
  });

  it('baja lo justo, en cascada, a los que pisa', () => {
    // d va arriba de todo: a baja una fila y arrastra a c; b no se toca.
    expect(at(moveItem(catalog, start(), 'd', { x: 0, y: 0 }))).toEqual({
      a: [0, 1, 2, 2],
      b: [2, 0, 2, 2],
      c: [0, 3, 4, 2],
      d: [0, 0, 2, 1],
    });
  });

  it('mantiene el bloque dentro de las columnas', () => {
    expect(at(moveItem(catalog, start(), 'd', { x: 9, y: 4 })).d).toEqual([2, 4, 2, 1]);
  });

  it('no mueve bloques ocultos', () => {
    const items = setHidden(start(), 'd', true);
    expect(moveItem(catalog, items, 'd', { x: 2, y: 0 })).toBe(items);
  });
});

describe('resizeItem', () => {
  it('crece hacia la derecha y abajo, y baja en cascada a los que alcanza', () => {
    expect(at(resizeItem(catalog, start(), 'a', { w: 4, h: 2 }))).toEqual({
      a: [0, 0, 4, 2],
      b: [2, 2, 2, 2],
      c: [0, 4, 4, 2],
      d: [0, 6, 2, 1],
    });
  });

  it('respeta los límites del bloque y de la grilla', () => {
    const items = start();
    expect(at(resizeItem(catalog, items, 'b', { w: 9, h: 99 })).b).toEqual([2, 0, 2, 6]);
    expect(at(resizeItem(catalog, items, 'a', { w: 0, h: 0 })).a).toEqual([0, 0, 1, 1]);
    expect(resizeItem(catalog, items, 'a', { w: 2, h: 2 })).toBe(items);
  });

  it('usa el mínimo de la presentación del bloque', () => {
    const bars = setPresentation(catalog, start(), 'a', 'bars');
    expect(at(resizeItem(catalog, bars, 'a', { w: 1, h: 1 })).a).toEqual([0, 0, 2, 2]);
  });

  it('al achicarse, los de abajo no suben: el hueco queda', () => {
    expect(at(resizeItem(catalog, start(), 'c', { w: 4, h: 1 })).d).toEqual([0, 4, 2, 1]);
  });
});

describe('pasos de teclado', () => {
  // En 4 columnas el paso es de 1 columna y 3 filas.
  it('arriba y abajo mueven 3 filas; los que pisa bajan', () => {
    const items = start();
    expect(at(stepItem(catalog, items, 'd', 'up'))).toEqual({
      a: [0, 2, 2, 2],
      b: [2, 0, 2, 2],
      c: [0, 4, 4, 2],
      d: [0, 1, 2, 1],
    });
    expect(at(stepItem(catalog, items, 'd', 'down')).d).toEqual([0, 7, 2, 1]);
    expect(stepItem(catalog, items, 'a', 'up')).toBe(items);
  });

  it('izquierda y derecha corren una columna sin salirse', () => {
    const items = start();
    expect(stepItem(catalog, items, 'a', 'left')).toBe(items);
    expect(at(stepItem(catalog, items, 'd', 'right')).d).toEqual([1, 4, 2, 1]);
    expect(stepItem(catalog, items, 'b', 'right')).toBe(items);
  });

  it('cambian el tamaño de a un paso dentro de los límites', () => {
    const items = start();
    expect(at(stepSize(catalog, items, 'd', 'right')).d).toEqual([0, 4, 3, 1]);
    expect(at(stepSize(catalog, items, 'd', 'down')).d).toEqual([0, 4, 2, 4]);
    expect(stepSize(catalog, items, 'd', 'up')).toBe(items);
  });

  it('el paso crece con las columnas de la grilla', () => {
    expect(keyboardStep(adminSummaryCatalog)).toEqual({ columns: 2, rows: 3 });
  });
});

describe('visibilidad, presentación y ajustes', () => {
  it('al ocultar nadie se mueve; al mostrar vuelve donde estaba y baja a los que pisa', () => {
    const hidden = setHidden(start(), 'c', true);
    expect(at(hidden)).toEqual(at(start()));
    const moved = moveItem(catalog, hidden, 'd', { x: 0, y: 2 });
    const shown = setHidden(moved, 'c', false);
    expect(at(shown)).toMatchObject({ c: [0, 2, 4, 2], d: [0, 4, 2, 1] });
    expect(overlappingIds(shown)).toEqual([]);
    expect(setHidden(shown, 'c', false)).toBe(shown);
  });

  it('solo acepta presentaciones y ajustes que el bloque ofrece', () => {
    const items = start();
    expect(setPresentation(catalog, items, 'a', 'pie')).toBe(items);
    expect(setPresentation(catalog, items, 'a', 'table')).toBe(items);
    expect(setPresentation(catalog, items, 'a', 'bars')[0]?.presentation).toBe('bars');
    expect(setSettings(catalog, items, 'a', { period: 'nunca' })).toBe(items);
    expect(setSettings(catalog, items, 'a', { period: '30d' })).toBe(items);
    expect(setSettings(catalog, items, 'a', { period: '7d' })[0]?.settings).toEqual({
      period: '7d',
    });
  });

  it('una presentación que necesita más lugar agranda el bloque hasta su mínimo', () => {
    expect(at(setPresentation(catalog, start(), 'd', 'bars')).d).toEqual([0, 4, 2, 2]);
  });
});

describe('tope de filas', () => {
  // c queda en la última fila admitida: cualquier cosa que lo empuje lo pasaría del tope.
  const nearLimit = (): readonly LayoutItem[] =>
    start().map((item) =>
      item.id === 'c' ? { ...item, y: 2000 } : item.id === 'd' ? { ...item, y: 1990 } : item,
    );

  it('en un gesto, el bloque se queda en el último paso válido en vez de volver al inicio', () => {
    const before = nearLimit();
    const step = moveItem(catalog, before, 'd', { x: 0, y: 1995 });
    expect(at(step).d).toEqual([0, 1995, 2, 1]);
    // Bajar d a la fila de c empujaría a c más allá del tope: se queda en el paso anterior.
    expect(moveItem(catalog, before, 'd', { x: 0, y: 2000 }, step)).toBe(step);
    // Desde la fila 1995, agrandar d a 6 de alto pisaría a c y lo pasaría del tope.
    const grown = resizeItem(catalog, step, 'd', { w: 2, h: 2 });
    expect(at(grown).d).toEqual([0, 1995, 2, 2]);
    expect(resizeItem(catalog, step, 'd', { w: 4, h: 6 }, grown)).toBe(grown);
  });

  it('un paso de teclado contra el borde conserva la referencia del borrador', () => {
    const items = start();
    const moved = stepItem(catalog, items, 'a', 'left');
    expect(moved).toBe(items);
    const base = start();
    expect(stepItem(catalog, items, 'a', 'left', base)).toBe(items);
  });

  it('mostrar un bloque que empujaría a otro más allá del tope lo pone en el primer hueco', () => {
    // a, oculto, pisa a d (en la fila 2000): mostrarlo ahí empujaría a d más allá del tope.
    const items = start().map((item) =>
      item.id === 'd'
        ? { ...item, y: 2000 }
        : item.id === 'a'
          ? { ...item, hidden: true, y: 1999 }
          : item,
    );
    const shown = setHidden(items, 'a', false);
    expect(shown.find((item) => item.id === 'a')).toMatchObject({ hidden: false, x: 0, y: 0 });
    expect(overlappingIds(shown)).toEqual([]);
  });
});

describe('scaleLayout', () => {
  it('apila en orden de lectura con una sola columna', () => {
    const stacked = scaleLayout(start(), 4, 1);
    expect(stacked.map((item) => [item.id, item.x, item.y, item.w])).toEqual([
      ['a', 0, 0, 1],
      ['b', 0, 2, 1],
      ['c', 0, 4, 1],
      ['d', 0, 6, 1],
    ]);
  });

  it('a la mitad de columnas conserva la disposición', () => {
    expect(at(scaleLayout(start(), 4, 2))).toEqual({
      a: [0, 0, 1, 2],
      b: [1, 0, 1, 2],
      c: [0, 2, 2, 2],
      d: [0, 4, 1, 1],
    });
    expect(scaleLayout(start(), 4, 4)).toEqual(start());
  });

  it('dos bloques contiguos siguen contiguos al escalar anchos impares', () => {
    const base = adminSummaryCatalog.defaultLayout.items.slice(0, 2);
    const [a, b] = base;
    if (!a || !b) throw new Error('faltan bloques');
    const pair = [
      { ...a, x: 0, y: 0, w: 49, hidden: false },
      { ...b, x: 49, y: 0, w: 47, hidden: false },
    ];
    const [left, right] = scaleLayout(pair, 96, 48);
    expect([left?.w, right?.x, right?.w, right?.y]).toEqual([25, 25, 23, 0]);
  });
});

describe('sameLayout', () => {
  it('compara bloque por bloque sin depender del orden de las claves', () => {
    const items = start();
    const reordered = [...items].reverse();
    expect(sameLayout(items, reordered)).toBe(true);
    const first = items[0];
    if (!first) throw new Error('sin bloques');
    const changed = [{ ...first, settings: { period: '7d' } }, ...items.slice(1)];
    expect(sameLayout(items, changed)).toBe(false);
    expect(sameLayout(items, items.slice(1))).toBe(false);
  });
});

describe('propiedades del motor sobre el catálogo real', () => {
  /** Generador determinista: el mismo caso se reproduce en cada corrida. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }

  it.each([1, 7, 42, 2026])(
    'ninguna secuencia de acciones deja un diseño que la API rechace (semilla %i)',
    (seed) => {
      const next = random(seed);
      const pick = <T>(values: readonly T[]): T => {
        const value = values[Math.floor(next() * values.length)];
        if (value === undefined) throw new Error('lista vacía');
        return value;
      };
      const ids = Object.keys(adminSummaryCatalog.widgets);
      const directions: Direction[] = ['up', 'down', 'left', 'right'];
      let items: readonly LayoutItem[] = adminSummaryCatalog.defaultLayout.items;
      for (let step = 0; step < 500; step++) {
        const id = pick(ids);
        const action = pick(['move', 'resize', 'step', 'size', 'toggle', 'show'] as const);
        if (action === 'move')
          items = moveItem(adminSummaryCatalog, items, id, {
            x: Math.floor(next() * 100) - 2,
            y: Math.floor(next() * 2200) - 2,
          });
        else if (action === 'resize')
          items = resizeItem(adminSummaryCatalog, items, id, {
            w: Math.floor(next() * 110),
            h: Math.floor(next() * 220),
          });
        else if (action === 'step')
          items = stepItem(adminSummaryCatalog, items, id, pick(directions));
        else if (action === 'size')
          items = stepSize(adminSummaryCatalog, items, id, pick(directions));
        else if (action === 'show') {
          const { presentations } =
            adminSummaryCatalog.widgets[id as keyof typeof adminSummaryCatalog.widgets];
          items = setPresentation(adminSummaryCatalog, items, id, pick(presentations));
        } else items = setHidden(items, id, next() < 0.5);
        const layout = { version: adminSummaryCatalog.version, items: [...items] };
        const issues = validateLayout(adminSummaryCatalog, layout);
        expect({ step, action, id, issues }).toEqual({ step, action, id, issues: [] });
        expect(viewLayoutSchema.safeParse(layout).success).toBe(true);
      }
    },
  );
});

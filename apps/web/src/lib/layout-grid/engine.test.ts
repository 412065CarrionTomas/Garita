import { z } from 'zod';
import {
  adminSummaryCatalog,
  defineViewCatalog,
  validateLayout,
  type LayoutItem,
} from '@garita/shared';
import {
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
  size: { min: { w: 1, h: 1 }, max: { w: 4, h: 6 }, default: { w: 2, h: 2 } },
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
    expect(moveItem(catalog, items, 'a', { x: 0, y: 1 })).toBe(items);
    expect(moveItem(catalog, items, 'nadie', { x: 1, y: 1 })).toBe(items);
  });

  it('baja un bloque por debajo de otro al pasar su mitad', () => {
    const items = start();
    // La mitad de c es la fila 3: en la 2 todavía no lo pasa.
    expect(moveItem(catalog, items, 'd', { x: 0, y: 2 })).not.toBe(items);
    expect(at(moveItem(catalog, items, 'a', { x: 0, y: 2 }))).toEqual(at(items));
    expect(at(moveItem(catalog, items, 'a', { x: 0, y: 3 }))).toEqual({
      a: [0, 4, 2, 2],
      b: [2, 0, 2, 2],
      c: [0, 2, 4, 2],
      d: [0, 6, 2, 1],
    });
  });

  it('sube un bloque por encima de otro y empuja a los de abajo', () => {
    expect(at(moveItem(catalog, start(), 'd', { x: 0, y: 0 }))).toEqual({
      a: [0, 1, 2, 2],
      b: [2, 0, 2, 2],
      c: [0, 3, 4, 2],
      d: [0, 0, 2, 1],
    });
  });

  it('mantiene el bloque dentro de las columnas', () => {
    const moved = moveItem(catalog, start(), 'd', { x: 9, y: 4 });
    expect(moved.find((item) => item.id === 'd')?.x).toBe(2);
    expect(at(moved).d).toEqual([2, 4, 2, 1]);
  });

  it('no mueve bloques ocultos', () => {
    const items = setHidden(start(), 'd', true);
    expect(moveItem(catalog, items, 'd', { x: 2, y: 0 })).toBe(items);
  });
});

describe('resizeItem', () => {
  it('crece hacia la derecha y empuja hacia abajo a los que alcanza', () => {
    // b baja y arrastra a c; d sube al hueco que c deja en las columnas 0-1 (sin huecos).
    expect(at(resizeItem(catalog, start(), 'a', { w: 4, h: 2 }))).toEqual({
      a: [0, 0, 4, 2],
      b: [2, 2, 2, 2],
      c: [0, 4, 4, 2],
      d: [0, 2, 2, 1],
    });
  });

  it('respeta los límites del bloque y de la grilla', () => {
    const items = start();
    expect(at(resizeItem(catalog, items, 'b', { w: 9, h: 99 })).b).toEqual([2, 0, 2, 6]);
    expect(at(resizeItem(catalog, items, 'a', { w: 0, h: 0 })).a).toEqual([0, 0, 1, 1]);
    expect(resizeItem(catalog, items, 'a', { w: 2, h: 2 })).toBe(items);
  });

  it('al achicarse, los de abajo suben', () => {
    expect(at(resizeItem(catalog, start(), 'c', { w: 4, h: 1 })).d).toEqual([0, 3, 2, 1]);
  });
});

describe('pasos de teclado', () => {
  it('arriba y abajo intercambian con el vecino más cercano que comparte columnas', () => {
    const items = start();
    expect(at(stepItem(catalog, items, 'd', 'up'))).toMatchObject({
      d: [0, 2, 2, 1],
      c: [0, 3, 4, 2],
    });
    expect(at(stepItem(catalog, items, 'c', 'down'))).toMatchObject({
      d: [0, 2, 2, 1],
      c: [0, 3, 4, 2],
    });
    expect(stepItem(catalog, items, 'a', 'up')).toBe(items);
    expect(stepItem(catalog, items, 'd', 'down')).toBe(items);
  });

  it('izquierda y derecha corren una columna sin salirse', () => {
    const items = start();
    expect(stepItem(catalog, items, 'a', 'left')).toBe(items);
    expect(at(stepItem(catalog, items, 'd', 'right')).d).toEqual([1, 4, 2, 1]);
    expect(stepItem(catalog, items, 'b', 'right')).toBe(items);
  });

  it('cambian el tamaño de a una celda', () => {
    const items = start();
    expect(at(stepSize(catalog, items, 'd', 'right')).d).toEqual([0, 4, 3, 1]);
    expect(at(stepSize(catalog, items, 'd', 'down')).d).toEqual([0, 4, 2, 2]);
    expect(stepSize(catalog, items, 'd', 'up')).toBe(items);
  });
});

describe('visibilidad, presentación y ajustes', () => {
  it('al ocultar, los demás ocupan el lugar; al mostrar, vuelve donde estaba', () => {
    const hidden = setHidden(start(), 'c', true);
    expect(at(hidden)).toMatchObject({ c: [0, 2, 4, 2], d: [0, 2, 2, 1] });
    expect(overlappingIds(hidden)).toEqual([]);
    const shown = setHidden(hidden, 'c', false);
    expect(at(shown)).toEqual(at(start()));
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
        const action = pick(['move', 'resize', 'step', 'size', 'toggle'] as const);
        if (action === 'move')
          items = moveItem(adminSummaryCatalog, items, id, {
            x: Math.floor(next() * 14) - 1,
            y: Math.floor(next() * 30) - 1,
          });
        else if (action === 'resize')
          items = resizeItem(adminSummaryCatalog, items, id, {
            w: Math.floor(next() * 14),
            h: Math.floor(next() * 14),
          });
        else if (action === 'step')
          items = stepItem(adminSummaryCatalog, items, id, pick(directions));
        else if (action === 'size')
          items = stepSize(adminSummaryCatalog, items, id, pick(directions));
        else items = setHidden(items, id, next() < 0.5);
        const issues = validateLayout(adminSummaryCatalog, {
          version: adminSummaryCatalog.version,
          items: [...items],
        });
        expect({ step, action, id, issues }).toEqual({ step, action, id, issues: [] });
      }
    },
  );
});

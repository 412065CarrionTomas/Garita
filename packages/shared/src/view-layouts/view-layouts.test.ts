import { z } from 'zod';
import {
  adminSummaryCatalog,
  compactInOrder,
  compactVertical,
  readingOrder,
  defineViewCatalog,
  favoritesInputSchema,
  findOverlap,
  rectsOverlap,
  reconcileLayout,
  resolveCollisions,
  scaleRects,
  validateLayout,
  widgetMinSize,
  viewCatalogs,
  viewPreferenceInputSchema,
  viewLayoutSchema,
  type ViewLayout,
} from './index';

const box = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h });

describe('geometría de la grilla', () => {
  it('considera superpuestos solo a los que comparten una celda', () => {
    expect(rectsOverlap(box('a', 0, 0, 2, 2), box('b', 1, 1, 2, 2))).toBe(true);
    expect(rectsOverlap(box('a', 0, 0, 2, 2), box('b', 2, 0, 2, 2))).toBe(false);
    expect(rectsOverlap(box('a', 0, 0, 2, 2), box('b', 0, 2, 2, 2))).toBe(false);
    expect(findOverlap([box('a', 0, 0, 2, 2), box('b', 4, 0, 1, 1), box('c', 1, 1, 1, 1)])).toEqual(
      [0, 2],
    );
  });

  it('sube los bloques hasta no dejar huecos y conserva el orden de entrada', () => {
    const result = compactVertical([box('b', 0, 9, 4, 2), box('a', 0, 3, 4, 2)]);
    expect(result.map((item) => [item.id, item.y])).toEqual([
      ['b', 2],
      ['a', 0],
    ]);
  });

  it('no sube un bloque por encima de otro de su columna y baja a los superpuestos', () => {
    const result = compactVertical([
      box('a', 0, 0, 6, 3),
      box('b', 2, 1, 6, 2),
      box('c', 8, 5, 4, 1),
    ]);
    expect(result.map((item) => item.y)).toEqual([0, 3, 0]);
  });

  it('ubica primero a los de mayor prioridad aunque estén más abajo', () => {
    const items = [box('a', 0, 0, 4, 2), box('b', 0, 2, 4, 2)];
    expect(readingOrder(items)).toEqual([0, 1]);
    const result = compactInOrder(items, [1, 0]);
    expect(result.map((item) => [item.id, item.y])).toEqual([
      ['a', 2],
      ['b', 0],
    ]);
    expect(compactInOrder(items, [0])).toEqual(items);
  });

  it('no modifica los objetos recibidos', () => {
    const input = [box('a', 0, 4, 1, 1)];
    compactVertical(input);
    expect(input[0]?.y).toBe(4);
  });
});

describe('catálogo del resumen', () => {
  it('arma el diseño por defecto válido y sin huecos', () => {
    const layout = adminSummaryCatalog.defaultLayout;
    expect(validateLayout(adminSummaryCatalog, layout)).toEqual([]);
    expect(reconcileLayout(adminSummaryCatalog, layout)).toEqual(layout);
    expect(layout.items.map((item) => item.id).sort()).toEqual(
      Object.keys(adminSummaryCatalog.widgets).sort(),
    );
    expect(viewCatalogs['admin-summary']).toBe(adminSummaryCatalog);
  });

  it('completa los ajustes por defecto y usa la primera presentación', () => {
    const compliance = adminSummaryCatalog.defaultLayout.items.find(
      (item) => item.id === 'compliance',
    );
    expect(compliance).toMatchObject({ presentation: 'line', settings: { period: '30d' } });
  });
});

function edited(change: (items: ViewLayout['items']) => void): ViewLayout {
  const layout = reconcileLayout(adminSummaryCatalog, adminSummaryCatalog.defaultLayout);
  change(layout.items);
  return layout;
}
function item(layout: ViewLayout, id: string) {
  const found = layout.items.find((entry) => entry.id === id);
  if (!found) throw new Error(`sin ${id}`);
  return found;
}

describe('validateLayout', () => {
  const codes = (layout: ViewLayout) =>
    validateLayout(adminSummaryCatalog, layout).map((issue) => issue.code);

  it('rechaza bloques desconocidos, repetidos y faltantes', () => {
    expect(
      codes(
        edited((items) => {
          const first = items[0];
          if (!first) return;
          items.push({ ...first, id: 'ajeno' });
          items.push({ ...first, hidden: true });
          items.splice(
            items.findIndex((entry) => entry.id === 'account'),
            1,
          );
        }),
      ),
    ).toEqual(expect.arrayContaining(['unknown_widget', 'duplicate', 'missing_widget']));
  });

  it('rechaza bloques fuera de la grilla o de su tamaño permitido', () => {
    const layout = edited((items) => {
      const sites = items.find((entry) => entry.id === 'sites');
      if (sites) Object.assign(sites, { x: 80, w: 28 });
      const account = items.find((entry) => entry.id === 'account');
      if (account) account.h = 201;
    });
    expect(codes(layout)).toEqual(expect.arrayContaining(['out_of_bounds', 'size']));
  });

  it('rechaza presentaciones y ajustes que el bloque no ofrece', () => {
    const layout = edited((items) => {
      const sites = items.find((entry) => entry.id === 'sites');
      if (sites) Object.assign(sites, { presentation: 'pie', settings: { sort: 'azar' } });
    });
    expect(codes(layout)).toEqual(['presentation', 'settings']);
  });

  it('rechaza superposiciones entre visibles pero no con ocultos', () => {
    const overlapped = edited((items) => {
      const shifts = items.find((entry) => entry.id === 'shiftsToday');
      if (shifts) shifts.y = 0;
    });
    expect(codes(overlapped)).toEqual(['overlap']);
    item(overlapped, 'shiftsToday').hidden = true;
    expect(codes(overlapped)).toEqual([]);
  });

  it('rechaza un diseño de otra versión del catálogo', () => {
    expect(codes({ ...adminSummaryCatalog.defaultLayout, version: 99 })).toEqual(['version']);
  });
});

describe('reconcileLayout', () => {
  it('vuelve al diseño por defecto si lo guardado no tiene forma de diseño', () => {
    for (const stored of [null, 'x', { items: 'no' }, 42])
      expect(reconcileLayout(adminSummaryCatalog, stored)).toEqual(
        adminSummaryCatalog.defaultLayout,
      );
  });

  it('descarta lo inválido, corrige lo corregible y agrega lo que falta', () => {
    const stored = {
      version: adminSummaryCatalog.version,
      items: [
        { ...adminSummaryCatalog.defaultLayout.items[1], w: 400, x: 11, presentation: 'pie' },
        { id: 'ajeno', x: 0, y: 0, w: 1, h: 1, hidden: false, presentation: 'x', settings: {} },
        { id: 'roto' },
        { ...adminSummaryCatalog.defaultLayout.items[1], y: 30 },
        {
          ...adminSummaryCatalog.defaultLayout.items[4],
          settings: { sort: 'azar', limit: '10', viejo: true },
        },
      ],
    };
    const result = reconcileLayout(adminSummaryCatalog, stored);
    expect(validateLayout(adminSummaryCatalog, result)).toEqual([]);
    expect(result.items.filter((entry) => entry.id === 'compliance')).toHaveLength(1);
    expect(item(result, 'compliance')).toMatchObject({ x: 0, w: 96, presentation: 'line' });
    expect(item(result, 'sites').settings).toEqual({ sort: 'worst', limit: '5' });
    expect(item(result, 'attention')).toMatchObject({ hidden: false, presentation: 'table' });
  });

  it('agrega los bloques nuevos con la visibilidad del diseño por defecto', () => {
    const stored = {
      version: adminSummaryCatalog.version,
      items: adminSummaryCatalog.defaultLayout.items.filter((entry) => entry.id !== 'siteDays'),
    };
    expect(item(reconcileLayout(adminSummaryCatalog, stored), 'siteDays').hidden).toBe(true);
  });

  it('nunca deja bloques por debajo del tope de filas', () => {
    const stored = edited((items) => {
      for (const entry of items) entry.y += 1990;
    });
    const result = reconcileLayout(adminSummaryCatalog, stored);
    expect(validateLayout(adminSummaryCatalog, result)).toEqual([]);
    expect(viewLayoutSchema.safeParse(result).success).toBe(true);
  });

  it('respeta los huecos: no sube a nadie y deja quietos a los ocultos', () => {
    const stored = edited((items) => {
      for (const entry of items) entry.y += 50;
      const account = items.find((entry) => entry.id === 'account');
      if (account) account.hidden = true;
    });
    const result = reconcileLayout(adminSummaryCatalog, stored);
    expect(item(result, 'attention').y).toBe(50);
    const accountY = item(adminSummaryCatalog.defaultLayout, 'account').y;
    expect(item(result, 'account')).toMatchObject({ hidden: true, y: accountY + 50 });
  });

  it('baja lo justo a los que quedaron superpuestos', () => {
    const stored = edited((items) => {
      const shifts = items.find((entry) => entry.id === 'shiftsToday');
      if (shifts) shifts.y = 10;
    });
    const result = reconcileLayout(adminSummaryCatalog, stored);
    expect(validateLayout(adminSummaryCatalog, result)).toEqual([]);
    // Pisaba a Atención ahora (alto 54): queda justo debajo, sin subir a los demás.
    expect(item(result, 'shiftsToday').y).toBe(54);
    expect(item(result, 'compliance').y).toBe(54);
  });
});

describe('migraciones de diseños guardados', () => {
  const v2 = (id: string, x: number, y: number, w: number, h: number) => ({
    ...box(id, x, y, w, h),
    hidden: false,
    presentation: 'table',
    settings: {},
  });

  it('lleva un diseño de la grilla de 12 columnas a la actual sin cambiar lo que se ve', () => {
    const result = reconcileLayout(adminSummaryCatalog, {
      version: 2,
      items: [v2('attention', 0, 0, 12, 6), v2('sites', 4, 6, 8, 7)],
    });
    // Versión 3 (× 2 columnas, × 3 filas) y después 4 (× 4 columnas, × 3 filas).
    expect(item(result, 'attention')).toMatchObject({ x: 0, y: 0, w: 96, h: 54 });
    expect(item(result, 'sites')).toMatchObject({ x: 32, y: 54, w: 64, h: 63 });
    expect(validateLayout(adminSummaryCatalog, result)).toEqual([]);
  });

  it('no migra un diseño de la versión actual ni uno sin versión', () => {
    const sites = v2('sites', 4, 0, 40, 40);
    for (const version of [adminSummaryCatalog.version, undefined])
      expect(
        item(reconcileLayout(adminSummaryCatalog, { version, items: [sites] }), 'sites'),
      ).toMatchObject({ x: 4, w: 40, h: 40 });
  });

  it('aplica las migraciones pendientes en orden de versión', () => {
    const catalog = defineViewCatalog({
      key: 'admin-summary',
      version: 3,
      columns: 24,
      roles: ['admin'],
      favoriteTypes: [],
      widgets: {
        a: {
          ...adminSummaryCatalog.widgets.account,
          size: { min: { w: 1, h: 1 }, max: { w: 24, h: 24 }, default: { w: 1, h: 1 } },
        },
      },
      defaultLayout: [{ id: 'a', x: 0, y: 0 }],
      migrations: {
        3: (items) => items.map((entry) => ({ ...entry, w: entry.w * 2 })),
        2: (items) => items.map((entry) => ({ ...entry, w: entry.w + 1 })),
      },
    });
    const stored = { version: 1, items: [{ ...v2('a', 0, 0, 2, 1), presentation: 'strip' }] };
    expect(item(reconcileLayout(catalog, stored), 'a').w).toBe(6);
  });

  it('scaleRects multiplica columnas y filas sin dejar bloques vacíos', () => {
    expect(scaleRects([box('a', 1, 2, 3, 4)], { columns: 2, rows: 3 })).toEqual([
      box('a', 2, 6, 6, 12),
    ]);
    expect(scaleRects([box('a', 0, 0, 1, 1)], { columns: 0.5, rows: 0.5 })[0]).toMatchObject({
      w: 1,
      h: 1,
    });
  });
});

describe('mínimos por presentación', () => {
  it('usa el mínimo de la presentación elegida o, si no tiene, el del bloque', () => {
    const { incidents } = adminSummaryCatalog.widgets;
    expect(widgetMinSize(incidents, 'pie')).toEqual({ w: 24, h: 37 });
    expect(widgetMinSize(incidents, 'bars')).toEqual(incidents.size.min);
  });

  it('valida y corrige el tamaño contra el mínimo de su presentación', () => {
    const layout = edited((items) => {
      const incidents = items.find((entry) => entry.id === 'incidents');
      if (incidents) Object.assign(incidents, { presentation: 'pie', h: 30 });
    });
    expect(validateLayout(adminSummaryCatalog, layout).map((issue) => issue.code)).toEqual([
      'size',
    ]);
    expect(item(reconcileLayout(adminSummaryCatalog, layout), 'incidents').h).toBe(37);
  });
});

describe('resolveCollisions', () => {
  it('deja en su lugar a los que no chocan y baja a los que sí, en cascada', () => {
    const result = resolveCollisions(
      [box('a', 0, 0, 4, 4), box('b', 0, 2, 4, 2), box('c', 0, 5, 4, 2), box('d', 6, 20, 2, 2)],
      [0, 1, 2, 3],
    );
    expect(result.map((rect) => rect.y)).toEqual([0, 4, 6, 20]);
  });
});

describe('defineViewCatalog', () => {
  const widget = {
    title: 'Uno',
    size: { min: { w: 2, h: 2 }, max: { w: 4, h: 4 }, default: { w: 2, h: 2 } },
    presentations: ['table'] as const,
    settings: z.object({}),
  };
  const base = {
    key: 'admin-summary' as const,
    version: 1,
    columns: 4,
    roles: ['admin' as const],
    favoriteTypes: [],
  };

  it('falla con tamaños incoherentes o ajustes sin valor por defecto', () => {
    expect(() =>
      defineViewCatalog({
        ...base,
        widgets: { one: { ...widget, size: { ...widget.size, max: { w: 9, h: 4 } } } },
        defaultLayout: [{ id: 'one', x: 0, y: 0 }],
      }),
    ).toThrow('tamaños incoherentes');
    expect(() =>
      defineViewCatalog({
        ...base,
        widgets: { one: { ...widget, settings: z.object({ period: z.enum(['7d']) }) } },
        defaultLayout: [{ id: 'one', x: 0, y: 0 }],
      }),
    ).toThrow('valor por defecto');
  });

  it('falla con mínimos por presentación incoherentes', () => {
    const wrong: Record<string, { w: number; h: number }>[] = [
      { pie: { w: 2, h: 2 } },
      { table: { w: 9, h: 2 } },
    ];
    for (const minByPresentation of wrong)
      expect(() =>
        defineViewCatalog({
          ...base,
          widgets: { one: { ...widget, size: { ...widget.size, minByPresentation } } },
          defaultLayout: [{ id: 'one', x: 0, y: 0 }],
        }),
      ).toThrow('incoherente');
  });

  it('falla con migraciones a versiones que el catálogo no tiene', () => {
    for (const to of [1, 2])
      expect(() =>
        defineViewCatalog({
          ...base,
          widgets: { one: widget },
          defaultLayout: [{ id: 'one', x: 0, y: 0 }],
          migrations: { [to]: (items) => items },
        }),
      ).toThrow('migración');
  });

  it('falla si el diseño por defecto superpone bloques u omite alguno', () => {
    expect(() =>
      defineViewCatalog({
        ...base,
        widgets: { one: widget, two: widget },
        defaultLayout: [
          { id: 'one', x: 0, y: 0 },
          { id: 'two', x: 1, y: 1 },
        ],
      }),
    ).toThrow('se superponen');
    expect(() =>
      defineViewCatalog({
        ...base,
        widgets: { one: widget, two: widget },
        defaultLayout: [{ id: 'one', x: 0, y: 0 }],
      }),
    ).toThrow('Falta el bloque two');
  });
});

describe('contratos de la API', () => {
  it('exige la fecha base al guardar un diseño', () => {
    const layout = adminSummaryCatalog.defaultLayout;
    expect(viewPreferenceInputSchema.safeParse({ layout }).success).toBe(false);
    expect(viewPreferenceInputSchema.safeParse({ layout, baseUpdatedAt: null }).success).toBe(true);
  });

  it('rechaza favoritos repetidos o de más', () => {
    expect(favoritesInputSchema.safeParse({ ids: ['a', 'b'] }).success).toBe(true);
    expect(favoritesInputSchema.safeParse({ ids: ['a', 'a'] }).success).toBe(false);
    expect(
      favoritesInputSchema.safeParse({ ids: Array.from({ length: 51 }, (_, i) => `p${i}`) })
        .success,
    ).toBe(false);
  });
});

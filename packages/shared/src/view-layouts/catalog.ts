import { z } from 'zod';
import type { UserRole } from '../roles';
import { compactVertical, gridHeight, rectsOverlap } from './grid';
import type { FavoriteEntityType, ViewKey } from './keys';
import { layoutItemSchema, type LayoutItem, type ViewLayout } from './layout';

export interface WidgetSize {
  w: number;
  h: number;
}

/**
 * Un bloque que una pantalla ofrece. `presentations` son las formas de mostrarlo (la primera es la
 * de por defecto) y `settings` sus ajustes: todos sus campos deben tener valor por defecto.
 */
export interface WidgetDefinition {
  readonly title: string;
  readonly size: {
    readonly min: WidgetSize;
    readonly max: WidgetSize;
    readonly default: WidgetSize;
  };
  readonly presentations: readonly [string, ...string[]];
  readonly settings: z.ZodType<Record<string, unknown>>;
}

export type WidgetDefinitions = Readonly<Record<string, WidgetDefinition>>;

/**
 * Lleva los bloques de un diseño guardado con la versión anterior a la versión que la declara.
 * Hace falta cuando cambia el significado de las celdas (p. ej. una grilla más fina); los
 * bloques nuevos o los tamaños fuera de rango ya los resuelve `reconcileLayout` sin migrar.
 */
export type LayoutMigration = (items: LayoutItem[]) => LayoutItem[];

export interface ViewCatalog<W extends WidgetDefinitions = WidgetDefinitions> {
  readonly key: ViewKey;
  /** Se incrementa cuando cambian los bloques, sus tamaños o sus ajustes. */
  readonly version: number;
  readonly columns: number;
  /** Roles que pueden ver la pantalla y guardar su diseño. */
  readonly roles: readonly UserRole[];
  /** Entidades que se pueden fijar en esta pantalla. */
  readonly favoriteTypes: readonly FavoriteEntityType[];
  readonly widgets: W;
  readonly defaultLayout: ViewLayout;
  /** Migraciones por versión de destino; se aplican en orden a los diseños más viejos. */
  readonly migrations?: Readonly<Record<number, LayoutMigration>>;
}

export interface ViewCatalogInput<W extends WidgetDefinitions> extends Omit<
  ViewCatalog<W>,
  'defaultLayout'
> {
  /** Posición inicial de cada bloque; tamaño, presentación y ajustes salen del bloque. */
  readonly defaultLayout: readonly {
    id: keyof W & string;
    x: number;
    y: number;
    hidden?: boolean;
  }[];
}

export type LayoutIssueCode =
  | 'version'
  | 'unknown_widget'
  | 'duplicate'
  | 'missing_widget'
  | 'out_of_bounds'
  | 'size'
  | 'presentation'
  | 'settings'
  | 'overlap';

export interface LayoutIssue {
  code: LayoutIssueCode;
  itemId?: string;
  message: string;
}

function widgetOf(catalog: ViewCatalog, id: string): WidgetDefinition | undefined {
  return Object.hasOwn(catalog.widgets, id) ? catalog.widgets[id] : undefined;
}

function defaultSettings(widget: WidgetDefinition): Record<string, unknown> {
  return widget.settings.parse({});
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Revisa un diseño contra el catálogo de su pantalla. Lo usa la API antes de guardar: un diseño
 * válido trae todos los bloques una sola vez, dentro de la grilla, con tamaños, presentación y
 * ajustes permitidos y sin bloques visibles superpuestos.
 */
export function validateLayout(catalog: ViewCatalog, layout: ViewLayout): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (layout.version !== catalog.version)
    issues.push({
      code: 'version',
      message: `El diseño es de la versión ${layout.version} y la pantalla está en la ${catalog.version}.`,
    });
  const seen = new Set<string>();
  for (const item of layout.items) {
    const widget = widgetOf(catalog, item.id);
    if (!widget) {
      issues.push({
        code: 'unknown_widget',
        itemId: item.id,
        message: `Bloque desconocido: ${item.id}.`,
      });
      continue;
    }
    if (seen.has(item.id))
      issues.push({ code: 'duplicate', itemId: item.id, message: `Bloque repetido: ${item.id}.` });
    seen.add(item.id);
    if (item.x + item.w > catalog.columns)
      issues.push({
        code: 'out_of_bounds',
        itemId: item.id,
        message: `${widget.title} se sale de las ${catalog.columns} columnas.`,
      });
    const { min, max } = widget.size;
    if (item.w < min.w || item.w > max.w || item.h < min.h || item.h > max.h)
      issues.push({
        code: 'size',
        itemId: item.id,
        message: `${widget.title} debe medir entre ${min.w}×${min.h} y ${max.w}×${max.h}.`,
      });
    if (!widget.presentations.includes(item.presentation))
      issues.push({
        code: 'presentation',
        itemId: item.id,
        message: `${widget.title} no se puede mostrar como ${item.presentation}.`,
      });
    if (!widget.settings.safeParse(item.settings).success)
      issues.push({
        code: 'settings',
        itemId: item.id,
        message: `Ajustes inválidos en ${widget.title}.`,
      });
  }
  for (const id of Object.keys(catalog.widgets))
    if (!seen.has(id))
      issues.push({ code: 'missing_widget', itemId: id, message: `Falta el bloque ${id}.` });
  const visible = layout.items.filter((item) => !item.hidden);
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i];
      const b = visible[j];
      if (a && b && rectsOverlap(a, b))
        issues.push({
          code: 'overlap',
          itemId: b.id,
          message: `Los bloques ${a.id} y ${b.id} se superponen.`,
        });
    }
  return issues;
}

/** Lleva un bloque a los límites de su definición y de la grilla, sin rechazarlo. */
function normalizeItem(
  catalog: ViewCatalog,
  widget: WidgetDefinition,
  item: LayoutItem,
): LayoutItem {
  const { min, max } = widget.size;
  const w = clamp(item.w, min.w, Math.min(max.w, catalog.columns));
  const settings = widget.settings.safeParse(item.settings);
  return {
    ...item,
    w,
    h: clamp(item.h, min.h, max.h),
    x: clamp(item.x, 0, catalog.columns - w),
    presentation: widget.presentations.includes(item.presentation)
      ? item.presentation
      : widget.presentations[0],
    settings: settings.success ? settings.data : defaultSettings(widget),
  };
}

// Sin versión (diseños de antes de que existiera) se toma como la actual: no se migra a ciegas.
const storedLayoutShape = z.object({
  version: z.number().int().optional(),
  items: z.array(z.unknown()),
});

/** Aplica, en orden, las migraciones posteriores a la versión con que se guardó el diseño. */
function migrate(catalog: ViewCatalog, version: number, items: LayoutItem[]): LayoutItem[] {
  return Object.entries(catalog.migrations ?? {})
    .map(([to, migration]) => [Number(to), migration] as const)
    .filter(([to]) => to > version && to <= catalog.version)
    .sort(([a], [b]) => a - b)
    .reduce((current, [, migration]) => migration(current), items);
}

/**
 * Convierte cualquier diseño guardado (de una versión vieja, editado a mano o roto) en uno válido
 * para el catálogo actual. Nunca falla: descarta bloques desconocidos o repetidos, ajusta tamaños,
 * presentaciones y ajustes, agrega al final los bloques nuevos y compacta hacia arriba. Antes
 * aplica las migraciones del catálogo si el diseño es de una versión anterior.
 */
export function reconcileLayout(catalog: ViewCatalog, stored: unknown): ViewLayout {
  const parsed = storedLayoutShape.safeParse(stored);
  if (!parsed.success)
    return {
      version: catalog.version,
      items: catalog.defaultLayout.items.map((item) => ({
        ...item,
        settings: { ...item.settings },
      })),
    };
  const storedItems = parsed.data.items.flatMap((raw) => {
    const item = layoutItemSchema.safeParse(raw);
    return item.success ? [item.data] : [];
  });
  const items: LayoutItem[] = [];
  const seen = new Set<string>();
  for (const item of migrate(catalog, parsed.data.version ?? catalog.version, storedItems)) {
    const widget = widgetOf(catalog, item.id);
    if (!widget || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(normalizeItem(catalog, widget, item));
  }
  for (const [id, widget] of Object.entries(catalog.widgets)) {
    if (seen.has(id)) continue;
    items.push({
      id,
      x: 0,
      y: gridHeight(items.filter((item) => !item.hidden)),
      ...widget.size.default,
      hidden: false,
      presentation: widget.presentations[0],
      settings: defaultSettings(widget),
    });
  }
  return { version: catalog.version, items: compactLayoutItems(items) };
}

/** Compacta hacia arriba los bloques visibles; los ocultos conservan su lugar para cuando vuelvan. */
export function compactLayoutItems(items: readonly LayoutItem[]): LayoutItem[] {
  const visibleIndexes = items.flatMap((item, index) => (item.hidden ? [] : [index]));
  const compacted = compactVertical(visibleIndexes.flatMap((index) => items[index] ?? []));
  const result = [...items];
  visibleIndexes.forEach((index, position) => {
    const item = compacted[position];
    if (item) result[index] = item;
  });
  return result;
}

/**
 * Declara el catálogo de una pantalla. Falla al cargar el módulo si el catálogo es incoherente
 * (tamaños fuera de rango, ajustes sin valor por defecto o diseño por defecto inválido): es un
 * error de programación y conviene verlo en el primer test, no en producción.
 */
export function defineViewCatalog<W extends WidgetDefinitions>(
  input: ViewCatalogInput<W>,
): ViewCatalog<W> {
  const problems: string[] = [];
  for (const [id, widget] of Object.entries(input.widgets)) {
    const { min, max, default: size } = widget.size;
    if (
      min.w < 1 ||
      min.h < 1 ||
      min.w > size.w ||
      size.w > max.w ||
      min.h > size.h ||
      size.h > max.h ||
      max.w > input.columns
    )
      problems.push(`${id}: tamaños incoherentes`);
    if (!widget.settings.safeParse({}).success)
      problems.push(`${id}: todos los ajustes necesitan valor por defecto`);
  }
  for (const to of Object.keys(input.migrations ?? {}))
    if (!Number.isInteger(Number(to)) || Number(to) < 2 || Number(to) > input.version)
      problems.push(`migración a la versión ${to}: debe estar entre 2 y ${input.version}`);
  const fail = () => new Error(`Catálogo ${input.key} inválido: ${problems.join(' · ')}`);
  // Sin bloques coherentes no se puede armar el diseño por defecto.
  if (problems.length) throw fail();
  const items: LayoutItem[] = input.defaultLayout.map((position) => {
    const widget = input.widgets[position.id];
    if (!widget) throw new Error(`Catálogo ${input.key}: bloque desconocido ${position.id}`);
    return {
      id: position.id,
      x: position.x,
      y: position.y,
      ...widget.size.default,
      hidden: position.hidden ?? false,
      presentation: widget.presentations[0],
      settings: defaultSettings(widget),
    };
  });
  const catalog: ViewCatalog<W> = {
    ...input,
    defaultLayout: { version: input.version, items },
  };
  problems.push(...validateLayout(catalog, catalog.defaultLayout).map((issue) => issue.message));
  if (problems.length) throw fail();
  return catalog;
}

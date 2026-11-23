import { z } from 'zod';
import { defineViewCatalog } from './catalog';
import { scaleRects } from './grid';

const period = z.enum(['7d', '30d']).default('30d');
const none = z.object({});
const ranking = z.object({
  sort: z.enum(['worst', 'name']).default('worst'),
  limit: z.enum(['5', '10', 'all']).default('5'),
});

/**
 * Resumen de la empresa del administrador. El diseño por defecto es la propuesta A ("Foja de
 * guardia"); "Atención ahora" puede mostrarse como columna angosta (propuesta B).
 */
export const adminSummaryCatalog = defineViewCatalog({
  key: 'admin-summary',
  // 2: se agregan los bloques de vigiladores y de casilleros; los diseños guardados los reciben al
  // reconciliarse. 3 y 4: grilla más fina (ver `migrations`); en la 4, con 96 columnas y filas de
  // 8 px, los bloques se ubican y miden casi al píxel. Los mínimos son, por presentación, lo justo
  // para que el bloque se entienda: el título y unas dos filas de contenido o un gráfico legible.
  version: 4,
  columns: 96,
  roles: ['admin'],
  favoriteTypes: ['site', 'guard', 'client'],
  widgets: {
    attention: {
      title: 'Atención ahora',
      size: {
        min: { w: 21, h: 28 },
        minByPresentation: { column: { w: 18, h: 28 } },
        max: { w: 96, h: 200 },
        default: { w: 96, h: 54 },
      },
      presentations: ['table', 'column'],
      settings: none,
    },
    compliance: {
      title: 'Cumplimiento',
      size: {
        min: { w: 30, h: 50 },
        minByPresentation: { table: { w: 26, h: 40 } },
        max: { w: 96, h: 200 },
        default: { w: 64, h: 72 },
      },
      presentations: ['line', 'bars', 'table'],
      settings: z.object({ period }),
    },
    shiftsToday: {
      title: 'Turnos de hoy',
      size: {
        min: { w: 22, h: 22 },
        minByPresentation: { pie: { w: 22, h: 33 }, table: { w: 26, h: 25 } },
        max: { w: 96, h: 200 },
        default: { w: 32, h: 45 },
      },
      presentations: ['bars', 'pie', 'table'],
      settings: none,
    },
    sites: {
      title: 'Predios',
      size: { min: { w: 32, h: 28 }, max: { w: 96, h: 200 }, default: { w: 64, h: 51 } },
      presentations: ['table'],
      settings: ranking,
    },
    guards: {
      title: 'Vigiladores',
      size: { min: { w: 32, h: 28 }, max: { w: 96, h: 200 }, default: { w: 96, h: 51 } },
      presentations: ['table'],
      settings: ranking,
    },
    incidents: {
      title: 'Incidentes',
      size: {
        min: { w: 22, h: 26 },
        minByPresentation: { pie: { w: 24, h: 37 }, table: { w: 22, h: 30 } },
        max: { w: 96, h: 200 },
        default: { w: 32, h: 72 },
      },
      presentations: ['bars', 'pie', 'table'],
      settings: z.object({ period }),
    },
    siteDays: {
      title: 'Casilleros por predio',
      size: { min: { w: 26, h: 28 }, max: { w: 96, h: 200 }, default: { w: 96, h: 54 } },
      presentations: ['grid'],
      settings: z.object({ days: z.enum(['7', '14', '30']).default('14') }),
    },
    account: {
      title: 'Cuenta',
      size: { min: { w: 22, h: 17 }, max: { w: 96, h: 200 }, default: { w: 96, h: 18 } },
      presentations: ['strip'],
      settings: none,
    },
  },
  defaultLayout: [
    { id: 'attention', x: 0, y: 0 },
    { id: 'compliance', x: 0, y: 54 },
    { id: 'shiftsToday', x: 64, y: 54 },
    { id: 'incidents', x: 64, y: 99 },
    { id: 'sites', x: 0, y: 126 },
    { id: 'guards', x: 0, y: 177 },
    { id: 'account', x: 0, y: 228 },
    // De la propuesta B: disponible desde Bloques, oculto en el diseño por defecto (A).
    { id: 'siteDays', x: 0, y: 246, hidden: true },
  ],
  migrations: {
    // 3: la grilla pasa de 12 columnas y filas de 72 px a 24 columnas y filas de 24 px.
    3: (items) => scaleRects(items, { columns: 2, rows: 3 }),
    // 4: de 24 columnas y filas de 24 px a 96 columnas y filas de 8 px.
    4: (items) => scaleRects(items, { columns: 4, rows: 3 }),
  },
});

export type AdminSummaryWidgetId = keyof typeof adminSummaryCatalog.widgets;

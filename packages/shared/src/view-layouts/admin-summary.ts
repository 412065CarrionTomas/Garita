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
  // reconciliarse. 3: grilla más fina (ver `migrations`), para mover y redimensionar con pasos chicos.
  version: 3,
  columns: 24,
  roles: ['admin'],
  favoriteTypes: ['site', 'guard', 'client'],
  widgets: {
    attention: {
      title: 'Atención ahora',
      size: { min: { w: 6, h: 9 }, max: { w: 24, h: 36 }, default: { w: 24, h: 18 } },
      presentations: ['table', 'column'],
      settings: none,
    },
    compliance: {
      title: 'Cumplimiento',
      size: { min: { w: 8, h: 15 }, max: { w: 24, h: 36 }, default: { w: 16, h: 24 } },
      presentations: ['line', 'bars', 'table'],
      settings: z.object({ period }),
    },
    shiftsToday: {
      title: 'Turnos de hoy',
      size: { min: { w: 6, h: 12 }, max: { w: 24, h: 24 }, default: { w: 8, h: 15 } },
      presentations: ['bars', 'pie', 'table'],
      settings: none,
    },
    sites: {
      title: 'Predios',
      size: { min: { w: 8, h: 9 }, max: { w: 24, h: 42 }, default: { w: 16, h: 17 } },
      presentations: ['table'],
      settings: ranking,
    },
    guards: {
      title: 'Vigiladores',
      size: { min: { w: 8, h: 9 }, max: { w: 24, h: 42 }, default: { w: 24, h: 17 } },
      presentations: ['table'],
      settings: ranking,
    },
    incidents: {
      title: 'Incidentes',
      size: { min: { w: 6, h: 15 }, max: { w: 24, h: 36 }, default: { w: 8, h: 24 } },
      presentations: ['bars', 'pie', 'table'],
      settings: z.object({ period }),
    },
    siteDays: {
      title: 'Casilleros por predio',
      size: { min: { w: 12, h: 12 }, max: { w: 24, h: 42 }, default: { w: 24, h: 18 } },
      presentations: ['grid'],
      settings: z.object({ days: z.enum(['7', '14', '30']).default('14') }),
    },
    account: {
      title: 'Cuenta',
      size: { min: { w: 8, h: 6 }, max: { w: 24, h: 12 }, default: { w: 24, h: 6 } },
      presentations: ['strip'],
      settings: none,
    },
  },
  defaultLayout: [
    { id: 'attention', x: 0, y: 0 },
    { id: 'compliance', x: 0, y: 18 },
    { id: 'shiftsToday', x: 16, y: 18 },
    { id: 'incidents', x: 16, y: 33 },
    { id: 'sites', x: 0, y: 42 },
    { id: 'guards', x: 0, y: 59 },
    { id: 'account', x: 0, y: 76 },
    // De la propuesta B: disponible desde Bloques, oculto en el diseño por defecto (A).
    { id: 'siteDays', x: 0, y: 82, hidden: true },
  ],
  migrations: {
    // 3: la grilla pasa de 12 columnas y filas de 72 px a 24 columnas y filas de 24 px.
    3: (items) => scaleRects(items, { columns: 2, rows: 3 }),
  },
});

export type AdminSummaryWidgetId = keyof typeof adminSummaryCatalog.widgets;

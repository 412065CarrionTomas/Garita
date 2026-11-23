import { z } from 'zod';
import { defineViewCatalog } from './catalog';

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
  // reconciliarse.
  version: 2,
  columns: 12,
  roles: ['admin'],
  favoriteTypes: ['site', 'guard', 'client'],
  widgets: {
    attention: {
      title: 'Atención ahora',
      size: { min: { w: 3, h: 3 }, max: { w: 12, h: 12 }, default: { w: 12, h: 6 } },
      presentations: ['table', 'column'],
      settings: none,
    },
    compliance: {
      title: 'Cumplimiento',
      size: { min: { w: 4, h: 5 }, max: { w: 12, h: 12 }, default: { w: 8, h: 8 } },
      presentations: ['line', 'bars', 'table'],
      settings: z.object({ period }),
    },
    shiftsToday: {
      title: 'Turnos de hoy',
      size: { min: { w: 3, h: 4 }, max: { w: 12, h: 8 }, default: { w: 4, h: 5 } },
      presentations: ['bars', 'pie', 'table'],
      settings: none,
    },
    sites: {
      title: 'Predios',
      size: { min: { w: 6, h: 4 }, max: { w: 12, h: 14 }, default: { w: 8, h: 7 } },
      presentations: ['table'],
      settings: ranking,
    },
    guards: {
      title: 'Vigiladores',
      size: { min: { w: 6, h: 4 }, max: { w: 12, h: 14 }, default: { w: 12, h: 6 } },
      presentations: ['table'],
      settings: ranking,
    },
    incidents: {
      title: 'Incidentes',
      size: { min: { w: 3, h: 5 }, max: { w: 12, h: 12 }, default: { w: 4, h: 8 } },
      presentations: ['bars', 'pie', 'table'],
      settings: z.object({ period }),
    },
    siteDays: {
      title: 'Casilleros por predio',
      size: { min: { w: 6, h: 4 }, max: { w: 12, h: 14 }, default: { w: 12, h: 6 } },
      presentations: ['grid'],
      settings: z.object({ days: z.enum(['7', '14', '30']).default('14') }),
    },
    account: {
      title: 'Cuenta',
      size: { min: { w: 4, h: 2 }, max: { w: 12, h: 4 }, default: { w: 12, h: 2 } },
      presentations: ['strip'],
      settings: none,
    },
  },
  defaultLayout: [
    { id: 'attention', x: 0, y: 0 },
    { id: 'compliance', x: 0, y: 6 },
    { id: 'shiftsToday', x: 8, y: 6 },
    { id: 'incidents', x: 8, y: 11 },
    { id: 'sites', x: 0, y: 14 },
    { id: 'guards', x: 0, y: 21 },
    { id: 'account', x: 0, y: 27 },
    // De la propuesta B: disponible desde Bloques, oculto en el diseño por defecto (A).
    { id: 'siteDays', x: 0, y: 29, hidden: true },
  ],
});

export type AdminSummaryWidgetId = keyof typeof adminSummaryCatalog.widgets;

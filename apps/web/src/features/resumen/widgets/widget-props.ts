import type { LayoutItem } from '@garita/shared';

/** Lo que recibe cada bloque: su lugar en el diseño, con presentación y ajustes ya validados. */
export interface WidgetProps {
  item: LayoutItem;
}

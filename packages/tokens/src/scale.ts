/** Espaciado en px, con la misma numeración que Tailwind (clave × 4). */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Radios de formulario: filete 1, sellos 2, controles 3, botones de la app 4. */
export const radius = { hairline: 1, sm: 2, md: 3, lg: 4, full: 9999 } as const;

/** Tamaño e interlineado en px. El cuerpo nunca baja de 14; en la app, de 16. */
export const fontSize = {
  xs: { size: 12, lineHeight: 16 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 22, lineHeight: 30 },
  '2xl': { size: 28, lineHeight: 36 },
  '3xl': { size: 34, lineHeight: 42 },
} as const;

export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** Objetivo táctil en px: `min` es el de Android (48), `minIos` el de iOS (44), `action` la acción principal. */
export const touch = { min: 48, minIos: 44, action: 56 } as const;

/** Duraciones en ms. `map` es el zoom a un predio; `highlight`, el resaltado de una fila recién creada. */
export const motion = { fast: 120, base: 200, map: 520, highlight: 1600 } as const;

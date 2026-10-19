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

export const radius = { sm: 6, md: 8, lg: 10, xl: 14, '2xl': 20, full: 9999 } as const;

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

/** Tamaños mínimos de objetivo táctil en px: general y acción principal del vigilador. */
export const touch = { min: 44, action: 56 } as const;

/** Duraciones de transición en ms. */
export const motion = { fast: 120, base: 200 } as const;

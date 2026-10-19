import { colors, type ColorToken } from './colors';
import { radius } from './scale';

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const declarations = (values: Record<ColorToken, string>) =>
  (Object.keys(values) as ColorToken[]).map((name) => `  --${kebab(name)}: ${values[name]};`);

/** Variables CSS del panel web: `:root` es el tema claro y `.dark` el oscuro. */
export function buildCss(): string {
  const root = [...declarations(colors.light), `  --radius: ${radius.lg / 16}rem;`];
  return [
    '/* Generado por scripts/build-css.mjs desde src/colors.ts. No editar a mano. */',
    `:root {\n${root.join('\n')}\n}\n`,
    `.dark {\n${declarations(colors.dark).join('\n')}\n}\n`,
  ].join('\n');
}

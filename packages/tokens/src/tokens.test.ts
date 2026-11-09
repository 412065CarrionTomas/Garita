import { buildCss, colors, type ColorToken } from './index';

const channel = (hex: string, start: number) => {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// Texto sobre fondo: WCAG 2.1 AA pide 4.5:1.
const textPairs: [ColorToken, ColorToken][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['cardForeground', 'card'],
  ['popoverForeground', 'popover'],
  ['mutedForeground', 'background'],
  ['mutedForeground', 'card'],
  ['mutedForeground', 'muted'],
  ['primaryForeground', 'primary'],
  ['secondaryForeground', 'secondary'],
  ['accentForeground', 'accent'],
  ['barForeground', 'bar'],
  ['barMuted', 'bar'],
  ['mutedForeground', 'secondary'],
  ['primary', 'background'],
  ['primary', 'card'],
  ...(['success', 'warning', 'danger', 'info'] as const).flatMap(
    (name): [ColorToken, ColorToken][] => [
      [`${name}Foreground`, name],
      [name, `${name}Soft`],
      [name, 'card'],
      [name, 'background'],
      [name, 'secondary'],
    ],
  ),
];

const nonText: [ColorToken, ColorToken][] = [
  ['input', 'card'],
  ['ring', 'card'],
  ['ring', 'background'],
];

describe.each(['light', 'dark'] as const)('tema %s', (theme) => {
  it.each(textPairs)('%s sobre %s llega a 4.5:1', (fg, bg) => {
    expect(contrast(colors[theme][fg], colors[theme][bg])).toBeGreaterThanOrEqual(4.5);
  });

  // Bordes de campos y foco: WCAG 1.4.11 pide 3:1 contra el fondo.
  it.each(nonText)('%s sobre %s llega a 3:1', (fg, bg) => {
    expect(contrast(colors[theme][fg], colors[theme][bg])).toBeGreaterThanOrEqual(3);
  });
});

it('los dos temas definen los mismos tokens', () => {
  expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
});

it('buildCss emite :root y .dark con todas las variables', () => {
  const css = buildCss();
  expect(css).toContain(':root {');
  expect(css).toContain('.dark {');
  expect(css).toContain('--bar-foreground: #FFFFFF;');
  expect(css.match(/--primary:/g)).toHaveLength(2);
  expect(css).not.toContain('--signal');
  expect(css).toContain('--radius: 0.1875rem;');
});

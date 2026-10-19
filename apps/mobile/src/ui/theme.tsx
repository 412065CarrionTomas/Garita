import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors as palettes } from '@garita/tokens';
import type { ColorToken } from '@garita/tokens';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'signal' | 'neutral';

const STORAGE_KEY = 'garita-theme';

/** Familias de Geist cargadas en el layout raíz (ver `fonts.ts`), una por peso. */
export const fontFamily = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
} as const;

interface ThemeValue {
  scheme: Scheme;
  mode: ThemeMode;
  colors: Record<ColorToken, string>;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Tema de la app: sigue al sistema salvo que el vigilador elija claro u oscuro, y lo recuerda.
 * Sin proveedor (tests, pantallas sueltas) `useTheme` cae al esquema del sistema.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') setModeState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void (
      next === 'system'
        ? AsyncStorage.removeItem(STORAGE_KEY)
        : AsyncStorage.setItem(STORAGE_KEY, next)
    ).catch(() => undefined);
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo(
    () => ({ scheme, mode, colors: palettes[scheme], setMode }),
    [scheme, mode, setMode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const system = useColorScheme();
  const context = useContext(ThemeContext);
  if (context) return context;
  const scheme: Scheme = system === 'dark' ? 'dark' : 'light';
  return { scheme, mode: 'system', colors: palettes[scheme], setMode: () => undefined };
}

/** Texto y fondo de cada tono de estado (el texto usa el color pleno sobre su fondo tenue). */
export function toneColors(colors: Record<ColorToken, string>, tone: Tone) {
  switch (tone) {
    case 'success':
      return { fg: colors.success, bg: colors.successSoft };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft };
    case 'info':
      return { fg: colors.info, bg: colors.infoSoft };
    case 'signal':
      return { fg: colors.signalForeground, bg: colors.signal };
    case 'neutral':
      return { fg: colors.mutedForeground, bg: colors.muted };
  }
}

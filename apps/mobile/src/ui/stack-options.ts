import { useTheme } from './theme';

/** Opciones de todo `Stack`: sin cabecera nativa y con el fondo del tema, para que no haya destello blanco en oscuro. */
export function useStackOptions() {
  const { colors } = useTheme();
  return { headerShown: false, contentStyle: { backgroundColor: colors.background } } as const;
}

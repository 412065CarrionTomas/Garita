import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import { useFonts } from 'expo-font';

import { fontFamily } from './theme';

/** Carga Geist (el mismo tipo que el panel web). `true` cuando ya se puede mostrar la app. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: Geist_400Regular,
    [fontFamily.medium]: Geist_500Medium,
    [fontFamily.semibold]: Geist_600SemiBold,
    [fontFamily.bold]: Geist_700Bold,
  });
  // Si falla la carga se sigue con la fuente del sistema: la app no debe quedar bloqueada.
  return loaded || error !== null;
}

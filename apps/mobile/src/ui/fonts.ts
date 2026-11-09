import {
  BarlowCondensed_500Medium,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from '@expo-google-fonts/barlow-condensed';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import { useFonts } from 'expo-font';

import { fontFamily } from './theme';

/** Carga Public Sans (texto) y Barlow Condensed (rótulos, sellos, números), empaquetadas. `true` cuando ya se puede mostrar la app. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: PublicSans_400Regular,
    [fontFamily.medium]: PublicSans_500Medium,
    [fontFamily.semibold]: PublicSans_600SemiBold,
    [fontFamily.bold]: PublicSans_700Bold,
    [fontFamily.condMedium]: BarlowCondensed_500Medium,
    [fontFamily.condSemibold]: BarlowCondensed_600SemiBold,
    [fontFamily.condBold]: BarlowCondensed_700Bold,
  });
  // Si falla la carga se sigue con la fuente del sistema: la app no debe quedar bloqueada.
  return loaded || error !== null;
}

import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { touch } from '@garita/tokens';
import { Text, useTheme } from '@/ui';

/** Alto de la barra sin el inset inferior: el pánico flotante se apoya encima. */
export const GUARD_BAR_HEIGHT = 64;

/**
 * Barra inferior del vigilador. En Android sigue el comportamiento de Material 3 (destinos fijos
 * abajo, zonas de 48 dp o más, borde a borde con el inset del sistema) con la estética de Foja:
 * hoja plana, filete arriba y subrayado de tinta en el destino activo. Con un turno iniciado, Hoy
 * pasa a ser la Ronda y el anillo de Pánico flota sobre la barra.
 */
export function GuardBar({ shiftId }: { shiftId: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const items: { label: string; href: Href; active: boolean }[] = [
    shiftId
      ? { label: 'Ronda', href: `/turno/${shiftId}`, active: pathname.startsWith('/turno/') }
      : { label: 'Hoy', href: '/', active: pathname === '/' },
    { label: 'Turnos', href: '/turnos', active: pathname.startsWith('/turnos') },
  ];
  // El visor de la cámara ocupa toda la pantalla.
  if (pathname.includes('escaneo')) return null;
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderColor: colors.foreground,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: item.active }}
          onPress={() => {
            if (!item.active) router.replace(item.href);
          }}
          style={[styles.item, { borderTopColor: item.active ? colors.foreground : 'transparent' }]}
        >
          <Text variant="label" color={item.active ? 'foreground' : 'mutedForeground'}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1.5 },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Math.max(GUARD_BAR_HEIGHT, touch.min),
    borderTopWidth: 3,
    marginTop: -1.5,
  },
});

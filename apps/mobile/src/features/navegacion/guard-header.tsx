import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, touch } from '@garita/tokens';
import { Badge, Icon, useTheme } from '@/ui';
import { getSyncSnapshot, subscribeSyncState } from '@/lib/cola';
import { subscribePanicChanges } from '@/lib/db/database';
import { GuardMenu } from './guard-menu';

const TAB_ROOTS = ['/', '/turnos', '/predios'];

/**
 * Cabecera fija del vigilador: en los destinos de la barra abre el menú lateral y en las pantallas
 * internas vuelve atrás. Avisa si quedan registros sin enviar.
 */
export function GuardHeader({ shiftId }: { shiftId: string | null }) {
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const atRoot =
    TAB_ROOTS.includes(pathname) || (Boolean(shiftId) && pathname === `/turno/${shiftId}`);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      void getSyncSnapshot().then((snapshot) => {
        if (mounted) setPending(snapshot.pendingCount);
      });
    refresh();
    const unsubscribe = subscribeSyncState(refresh);
    // Cerrar el turno sin señal o encolar un pánico avisa por acá, no por la cola de envío.
    const unsubscribePanic = subscribePanicChanges(refresh);
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribePanic();
    };
  }, []);
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      <View style={styles.row}>
        {atRoot ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir menú"
            onPress={() => setOpen(true)}
            style={styles.touch}
          >
            <Icon name="menu" size={24} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace(shiftId ? `/turno/${shiftId}` : '/')
            }
            style={styles.touch}
          >
            <Icon name="back" size={24} />
          </Pressable>
        )}
        {pending > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pending} registros por enviar. Ver envíos`}
            onPress={() => {
              if (pathname !== '/envio') router.push('/envio');
            }}
            style={styles.touch}
          >
            <Badge tone="warning" variant="dashed" label={`${pending} por enviar`} />
          </Pressable>
        )}
      </View>
      <GuardMenu open={open} pendingCount={pending} onClose={() => setOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
  },
  touch: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
});

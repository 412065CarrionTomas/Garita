import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, touch } from '@garita/tokens';
import { Badge, Icon, useTheme } from '@/ui';
import { getSyncSnapshot, subscribeSyncState } from '@/lib/cola';
import { GuardMenu } from './guard-menu';

/** Cabecera fija del vigilador: abre el menú lateral y avisa si quedan registros sin enviar. */
export function GuardHeader() {
  const { colors } = useTheme();
  const router = useRouter();
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
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menú"
          onPress={() => setOpen(true)}
          style={styles.touch}
        >
          <Icon name="menu" size={24} />
        </Pressable>
        {pending > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pending} registros por enviar. Ver envíos`}
            onPress={() => router.push('/envio')}
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

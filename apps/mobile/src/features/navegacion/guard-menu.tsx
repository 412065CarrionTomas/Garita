import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space } from '@garita/tokens';
import { Button, ListItem, Text, ThemeSwitch, useTheme } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
import { getSyncSnapshot } from '@/lib/cola';

/** Menú lateral del vigilador: cuenta, tema, envíos pendientes, documentos legales y salida. */
export function GuardMenu({
  open,
  pendingCount,
  onClose,
}: {
  open: boolean;
  pendingCount: number;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  const confirmLogout = async () => {
    // El menú se cierra antes: en iOS un Alert sobre un Modal abierto puede no mostrarse.
    onClose();
    // Se cuenta en el momento: el número de la cabecera puede ir atrasado (p. ej. cierre sin señal).
    const { pendingCount: pending } = await getSyncSnapshot();
    if (pending === 0) return void logout();
    Alert.alert(
      'Registros pendientes de envío',
      `Tenés ${pending === 1 ? '1 registro pendiente' : `${pending} registros pendientes`} de envío. No se descartan, pero no se envían hasta que vuelvas a ingresar. ¿Cerrar sesión igual?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => void logout() },
      ],
    );
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <SafeAreaView
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: colors.background, borderColor: colors.foreground },
          ]}
        >
          {user && (
            <View>
              <Text variant="heading">{`${user.firstName} ${user.lastName}`}</Text>
              <Text color="mutedForeground">{`Vigilador · ${user.company.name}`}</Text>
            </View>
          )}
          <ThemeSwitch />
          <ListItem
            title="Envíos"
            subtitle={
              pendingCount
                ? `${pendingCount} ${pendingCount === 1 ? 'pendiente' : 'pendientes'}`
                : 'Todo enviado'
            }
            onPress={() => go('/envio')}
          />
          <ListItem title="Términos y condiciones" onPress={() => go('/legal/terminos')} />
          <ListItem title="Política de privacidad" onPress={() => go('/legal/privacidad')} />
          <View style={styles.fill} />
          <Button variant="ghost" label="Cerrar sesión" onPress={() => void confirmLogout()} />
        </SafeAreaView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar menú"
          style={[styles.fill, styles.scrim, { backgroundColor: colors.foreground }]}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  fill: { flex: 1 },
  scrim: { opacity: 0.4 },
  panel: { width: '82%', padding: space[5], gap: space[4], borderRightWidth: 1.5 },
});

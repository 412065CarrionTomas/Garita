import { useState } from 'react';
import { Link } from 'expo-router';
import { z } from 'zod';
import { StyleSheet } from 'react-native';
import { space } from '@garita/tokens';
import { Banner, Button, Input, Screen, Text } from '@/ui';
import { RESET_MESSAGE, useAuth } from './auth-context';

export function RecoveryScreen() {
  const { recover } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function submit() {
    const result = z.email('Ingresá un correo válido').safeParse(email);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Ingresá un correo válido');
      return;
    }
    setError('');
    try {
      await recover(result.data);
      setSent(true);
    } catch (caught) {
      // Solo se oculta "usuario inexistente" para no revelar si el correo existe.
      if ((caught as { code?: string }).code === 'auth/user-not-found') setSent(true);
      else setError('No pudimos enviar el enlace. Revisá tu conexión e intentá de nuevo.');
    }
  }
  return (
    <Screen scroll style={styles.container}>
      <Text variant="display">Garita</Text>
      <Text color="mutedForeground">Recuperá el acceso a tu cuenta.</Text>
      <Text variant="title">Recuperar contraseña</Text>
      {sent ? (
        <>
          <Banner tone="success" role="text">
            {RESET_MESSAGE}
          </Banner>
          <Text>Revisá también la carpeta de spam.</Text>
        </>
      ) : (
        <>
          <Text>Te enviaremos un enlace para crear una nueva contraseña.</Text>
          <Input
            label="Correo electrónico"
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          {!!error && <Banner tone="danger">{error}</Banner>}
          <Button size="lg" label="Enviar enlace" onPress={() => void submit()} />
        </>
      )}
      <Link href="/(auth)/login" asChild>
        <Button variant="ghost" label="Volver a ingresar" accessibilityRole="link" />
      </Link>
    </Screen>
  );
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
});

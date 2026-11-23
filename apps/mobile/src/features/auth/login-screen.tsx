import { useState } from 'react';
import { Link, router } from 'expo-router';
import { z } from 'zod';
import { StyleSheet } from 'react-native';
import { space } from '@garita/tokens';
import { Banner, Button, Input, Loading, Screen, Text } from '@/ui';
import { AuthFlowError, useAuth } from './auth-context';
import { LegalLinks, roleHome } from '../legal/legal-screens';

const schema = z.object({
  email: z.email('Ingresá un correo válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

export function LoginScreen() {
  const { user, loading, login, error: sessionError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) {
    return (
      <Screen>
        <Loading label="Verificando sesión…" />
      </Screen>
    );
  }
  if (user) {
    router.replace(roleHome(user));
    return null;
  }
  async function submit() {
    const result = schema.safeParse({ email, password });
    if (!result.success) {
      setMessage(result.error.issues[0]?.message ?? 'Revisá los datos');
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const profile = await login(result.data.email, result.data.password);
      router.replace(roleHome(profile));
    } catch (reason) {
      setMessage(reason instanceof AuthFlowError ? reason.message : 'No pudimos iniciar sesión');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen scroll style={styles.container}>
      <Text variant="display">Garita</Text>
      <Text color="mutedForeground">Tu herramienta para trabajar en campo.</Text>
      <Text variant="title">Iniciar sesión</Text>
      <Input
        label="Correo electrónico"
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Input
        label="Contraseña"
        autoComplete="password"
        secureTextEntry={!visible}
        value={password}
        onChangeText={setPassword}
        trailing={
          <Button
            variant="ghost"
            label={visible ? 'Ocultar' : 'Mostrar'}
            accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onPress={() => setVisible(!visible)}
          />
        }
      />
      {!!(message || sessionError) && <Banner tone="danger">{message || sessionError}</Banner>}
      <Button
        size="lg"
        label={busy ? 'Ingresando…' : 'Ingresar'}
        accessibilityLabel="Ingresar"
        disabled={busy}
        onPress={() => void submit()}
      />
      <Link href="/(auth)/recuperar" asChild>
        <Button variant="ghost" label="Olvidé mi contraseña" accessibilityRole="link" />
      </Link>
      <LegalLinks />
    </Screen>
  );
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
});

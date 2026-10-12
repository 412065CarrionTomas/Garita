import { useState } from 'react';
import { Link, router } from 'expo-router';
import { z } from 'zod';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthFlowError, useAuth } from './auth-context';

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
  if (loading) return <Text accessibilityRole="progressbar">Verificando sesión…</Text>;
  if (user) {
    router.replace(user.role === 'guard' ? '/(guard)' : '/(configuration)');
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
      router.replace(profile.role === 'guard' ? '/(guard)' : '/(configuration)');
    } catch (reason) {
      setMessage(reason instanceof AuthFlowError ? reason.message : 'No pudimos iniciar sesión');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Iniciar sesión</Text>
        <Text style={styles.label}>Correo electrónico</Text>
        <TextInput
          accessibilityLabel="Correo electrónico"
          autoComplete="email"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          accessibilityLabel="Contraseña"
          autoComplete="password"
          secureTextEntry={!visible}
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          onPress={() => setVisible(!visible)}
        >
          <Text style={styles.link}>{visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}</Text>
        </Pressable>
        {(message || sessionError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {message || sessionError}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ingresar"
          disabled={busy}
          onPress={() => void submit()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{busy ? 'Ingresando…' : 'Ingresar'}</Text>
        </Pressable>
        <Link href="/(auth)/recuperar" accessibilityRole="link" style={styles.link}>
          Olvidé mi contraseña
        </Link>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 30, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderColor: '#737373',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  link: { color: '#174ea6', fontSize: 16, paddingVertical: 8 },
  error: { color: '#a11212', fontSize: 16 },
  button: {
    minHeight: 48,
    borderRadius: 6,
    backgroundColor: '#171717',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

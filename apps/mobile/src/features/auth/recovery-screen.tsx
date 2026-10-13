import { useState } from 'react';
import { Link } from 'expo-router';
import { z } from 'zod';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Recuperar contraseña</Text>
        {sent ? (
          <>
            <Text accessibilityRole="text">{RESET_MESSAGE}</Text>
            <Text>Revisá también la carpeta de spam.</Text>
          </>
        ) : (
          <>
            <Text>Te enviaremos un enlace para crear una nueva contraseña.</Text>
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
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar enlace"
              onPress={() => void submit()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Enviar enlace</Text>
            </Pressable>
          </>
        )}
        <Link href="/(auth)/login" accessibilityRole="link" style={styles.link}>
          Volver a ingresar
        </Link>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 30, fontWeight: '700' },
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
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

import { useState } from 'react';
import { Link, Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LEGAL_OWNER, privacyPolicy, termsOfService } from '@garita/shared';
import type { AuthMeResponse, LegalDocument } from '@garita/shared';
import { space } from '@garita/tokens';
import { Banner, Button, Screen, Text } from '@/ui';
import { useAuth } from '../auth/auth-context';

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  terminos: termsOfService,
  privacidad: privacyPolicy,
};

export const ACCEPT_LEGAL_PATH = '/aceptar-terminos';

/** Destino tras ingresar: primero la aceptación pendiente, después el área del rol. */
export function homePath(user: AuthMeResponse) {
  if (user.legalAcceptanceRequired) return ACCEPT_LEGAL_PATH;
  return user.role === 'guard' ? '/(guard)' : '/(configuration)';
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** Texto completo, legible sin conexión porque viaja dentro de la app. */
export function LegalDocumentScreen({ slug }: { slug: string }) {
  const document = LEGAL_DOCUMENTS[slug] ?? termsOfService;
  return (
    <Screen scroll style={styles.document}>
      <Text variant="title">{document.title}</Text>
      <Text color="mutedForeground">Última actualización: {formatDate(document.updatedAt)}</Text>
      <Text>{document.intro}</Text>
      {document.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text variant="heading">{section.heading}</Text>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph}>{paragraph}</Text>
          ))}
        </View>
      ))}
      <Text color="mutedForeground">Contacto: {LEGAL_OWNER.email}</Text>
    </Screen>
  );
}

export function LegalLinks() {
  return (
    <View style={styles.links}>
      <Link href="/legal/terminos" asChild>
        <Button variant="ghost" label="Términos y Condiciones" accessibilityRole="link" />
      </Link>
      <Link href="/legal/privacidad" asChild>
        <Button variant="ghost" label="Política de Privacidad" accessibilityRole="link" />
      </Link>
    </View>
  );
}

/** Aceptación explícita de la versión vigente; tocar el botón es el acto de aceptar. */
export function AcceptLegalScreen() {
  const { user, acceptLegal, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function accept() {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await acceptLegal();
      router.replace(user.role === 'guard' ? '/(guard)' : '/(configuration)');
    } catch {
      setError('No pudimos registrar la aceptación. Revisá tu conexión e intentá nuevamente.');
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <Screen scroll style={styles.accept}>
      <Text variant="title">Términos y Condiciones</Text>
      <Text>
        Para usar Garita necesitás leer y aceptar la versión vigente de los Términos y Condiciones y
        de la Política de Privacidad.
      </Text>
      <LegalLinks />
      {!!error && <Banner tone="danger">{error}</Banner>}
      <Button
        size="lg"
        label={busy ? 'Guardando…' : 'Leí y acepto'}
        accessibilityLabel="Leí y acepto los Términos y Condiciones y la Política de Privacidad"
        disabled={busy}
        onPress={() => void accept()}
      />
      <Button variant="ghost" label="Cerrar sesión" onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  document: { gap: space[3], paddingBottom: space[8] },
  section: { gap: space[2] },
  links: { gap: space[1] },
  accept: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
});

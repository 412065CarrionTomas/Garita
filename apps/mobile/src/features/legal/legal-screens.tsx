import { useEffect, useState } from 'react';
import { Link, Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatLegalDate, LEGAL_OWNER, privacyPolicy, termsOfService } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import { space } from '@garita/tokens';
import { ApiError } from '@/lib/api-client';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { Banner, Button, Screen, Text } from '@/ui';
import { useAuth } from '../auth/auth-context';
import { getRunningPanicShift } from '../panico/running-shift';

export const ACCEPT_LEGAL_PATH = '/aceptar-terminos';

export function roleHome(user: Pick<AuthMeResponse, 'role'>) {
  return user.role === 'guard' ? '/(guard)' : '/(configuration)';
}

async function hasRunningShift() {
  try {
    return (await getRunningPanicShift(await createDefaultFieldRepository())) !== null;
  } catch {
    return false;
  }
}

/**
 * Decide si el área del rol espera la aceptación de la versión vigente. La usan los layouts de
 * cada área, así ninguna entrada (notificación, permisos, enlace) la saltea. Un turno en curso del
 * vigilador nunca queda detrás de la aceptación: el pánico debe seguir a mano.
 */
export function useLegalGate(user: AuthMeResponse | null): 'checking' | 'allow' | 'require' {
  const needsAcceptance = Boolean(user?.legalAcceptanceRequired);
  const isGuard = user?.role === 'guard';
  const key = `${user?.id ?? ''}:${String(needsAcceptance)}`;
  const [checked, setChecked] = useState<{ key: string; running: boolean } | null>(null);
  useEffect(() => {
    if (!needsAcceptance || !isGuard) return;
    let mounted = true;
    void hasRunningShift().then((running) => {
      if (mounted) setChecked({ key, running });
    });
    return () => {
      mounted = false;
    };
  }, [key, needsAcceptance, isGuard]);
  if (!needsAcceptance) return 'allow';
  if (!isGuard) return 'require';
  if (checked?.key !== key) return 'checking';
  return checked.running ? 'allow' : 'require';
}

function BackButton() {
  return (
    <Button
      variant="ghost"
      label="Volver"
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
    />
  );
}

/** Texto completo, legible sin conexión porque viaja dentro de la app. */
export function LegalDocumentScreen({ slug }: { slug: string }) {
  const document = slug === 'privacidad' ? privacyPolicy : termsOfService;
  return (
    <Screen scroll style={styles.document}>
      <View style={styles.back}>
        <BackButton />
      </View>
      <Text variant="title">{document.title}</Text>
      <Text color="mutedForeground">
        Última actualización: {formatLegalDate(document.updatedAt)}
      </Text>
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
      router.replace(roleHome(user));
    } catch (reason) {
      // 400: la API ya exige una versión más nueva que la incluida en esta app.
      setError(
        reason instanceof ApiError && reason.status === 400
          ? 'Hay una versión más reciente de los términos. Actualizá la app de Garita para aceptarla.'
          : 'No pudimos registrar la aceptación. Revisá tu conexión e intentá nuevamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  if (!user.legalAcceptanceRequired) return <Redirect href={roleHome(user)} />;
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
  back: { alignItems: 'flex-start' },
  section: { gap: space[2] },
  links: { gap: space[1] },
  accept: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
});

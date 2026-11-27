import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { space, radius, touch } from '@garita/tokens';
import { nfcConfigurationSitesSchema } from '@garita/shared';
import type { z } from 'zod';
import { Banner, Button, Icon, Input, Loading, Screen, Text, useTheme } from '@/ui';
import { GuardMenu } from '@/features/navegacion/guard-menu';
import { useAuth } from '@/features/auth/auth-context';
import { apiGet } from '@/lib/api-client';
import { NfcBlocker, useNfcState } from '@/features/etiquetas/nfc-status';
import { ProgressBar } from '@/features/etiquetas/parts';

type Site = z.infer<typeof nfcConfigurationSitesSchema>[number];

/** Sin mayúsculas ni tildes: "alamos" encuentra "Los Álamos". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Primero los predios con puntos sin etiqueta; los completos y los vacíos, al final. */
const byPending = (a: Site, b: Site) =>
  Number(a.tagged >= a.total) - Number(b.tagged >= b.total) || a.name.localeCompare(b.name, 'es');

/**
 * Inicio del modo NFC: el administrador asocia etiquetas desde la oficina. Cada predio muestra
 * cuántos puntos faltan; los puntos y el escaneo van en la pantalla del predio.
 */
export default function ConfigurationHome() {
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  const nfc = useNfcState();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState(false);
  // "Reintentar" suma un intento y vuelve a pedir los predios.
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const shown = sites?.filter((site) => fold(site.name).includes(fold(query.trim())));

  // Al volver de un predio se ve el avance nuevo.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      apiGet('/configuracion/predios', nfcConfigurationSitesSchema)
        .then((loaded) => {
          if (!mounted) return;
          setSites([...loaded].sort(byPending));
          setError(false);
        })
        .catch(() => {
          if (mounted) setError(true);
        });
      return () => {
        mounted = false;
      };
      // `attempt` solo dispara la nueva consulta.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]),
  );

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menú"
          onPress={() => setMenu(true)}
          style={styles.menuButton}
        >
          <Icon name="menu" size={24} />
        </Pressable>
        <Text color="mutedForeground">
          {user?.role === 'admin' ? 'Administrador' : 'Supervisor'}
        </Text>
      </View>
      <View style={styles.intro}>
        <Text variant="title">Etiquetas NFC</Text>
        <Text>Asociá una etiqueta a cada punto de control y escribile su número.</Text>
      </View>
      <NfcBlocker state={nfc} />
      <Button
        variant="secondary"
        size="lg"
        label="Identificar etiqueta"
        accessibilityLabel="Identificar etiqueta: ver de qué punto es"
        disabled={nfc !== 'ready'}
        onPress={() => router.push('/(configuration)/identificar')}
      />

      <Text variant="heading" style={styles.section}>
        Predios
      </Text>
      {error && (
        <Banner
          tone="danger"
          action={
            <Button
              variant="outline"
              label="Reintentar"
              onPress={() => {
                setError(false);
                setAttempt((n) => n + 1);
              }}
            />
          }
        >
          No se pudieron cargar los predios. Revisá la conexión.
        </Banner>
      )}
      {!sites && !error && <Loading label="Cargando predios…" />}
      {sites?.length === 0 && (
        <Text color="mutedForeground">No tenés predios para configurar.</Text>
      )}
      {!!sites?.length && (
        <Input
          label="Buscar predio"
          placeholder="Nombre del predio"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
      )}
      {!!sites?.length && !shown?.length && (
        <Text color="mutedForeground">{`Ningún predio coincide con "${query.trim()}".`}</Text>
      )}
      {shown?.map((site) => (
        <SiteRow key={site.id} site={site} />
      ))}
      <GuardMenu open={menu} onClose={() => setMenu(false)} />
    </Screen>
  );
}

function SiteRow({ site }: { site: Site }) {
  const { colors } = useTheme();
  const pending = site.total - site.tagged;
  const summary = !site.total
    ? 'Sin puntos cargados'
    : pending
      ? `Faltan ${pending} de ${site.total} puntos`
      : `Completo: ${site.total} puntos con etiqueta`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${site.name}. ${summary}`}
      onPress={() =>
        router.push({
          pathname: '/(configuration)/predio/[id]',
          params: { id: site.id, nombre: site.name },
        })
      }
      style={({ pressed }) => [
        styles.site,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.siteTop}>
        <Text variant="subheading" style={styles.flex}>
          {site.name}
        </Text>
        <Icon name="forward" />
      </View>
      <View style={styles.siteSummary}>
        {!pending && !!site.total && <Icon name="check" color="success" />}
        <Text color={pending || !site.total ? 'mutedForeground' : 'success'}>{summary}</Text>
      </View>
      {!!site.total && <ProgressBar done={site.tagged} total={site.total} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[1] },
  section: { marginTop: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  menuButton: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  site: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
    minHeight: touch.action,
  },
  siteTop: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  siteSummary: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
});

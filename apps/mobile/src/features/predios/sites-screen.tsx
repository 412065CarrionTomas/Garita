import { useState } from 'react';
import { FlatList, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES, guardSitesSchema, type GuardSite } from '@garita/shared';
import { Banner, Button, Card, ListItem, Loading, Text, useTheme } from '@/ui';
import { cachedNotice, useCachedGet } from '@/lib/cached-get';
import { directionsUrl } from '@/lib/maps';

const nextFormat = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Predios del vigilador: cómo llegar, cómo entrar, qué recorrer y quién supervisa. */
export function SitesScreen() {
  const { colors } = useTheme();
  const { data, savedAt, loading, error, reload } = useCachedGet('/mis-predios', guardSitesSchema);
  const [open, setOpen] = useState<string | null>(null);
  const sites = data ?? [];
  return (
    <FlatList
      data={sites}
      keyExtractor={(site) => site.id}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="title">Predios</Text>
          {/* La copia se avisa solo si la API no respondió. */}
          {error && savedAt ? (
            <Banner tone="warning">{cachedNotice(savedAt)}</Banner>
          ) : (
            error && (
              <Banner tone="danger">
                {error === 'suspended'
                  ? SUSPENSION_MESSAGES.guard
                  : 'No se pudieron cargar los predios. Deslizá hacia abajo para reintentar.'}
              </Banner>
            )
          )}
          {loading && !data && <Loading label="Cargando predios…" />}
        </View>
      }
      ListEmptyComponent={
        loading || error ? null : (
          <Text color="mutedForeground">Todavía no tenés predios asignados.</Text>
        )
      }
      renderItem={({ item }) =>
        open === item.id ? (
          <SiteDetail site={item} onClose={() => setOpen(null)} />
        ) : (
          <ListItem
            title={item.name}
            subtitle={item.address}
            detail={
              item.nextShiftAt
                ? `Próximo turno: ${nextFormat.format(new Date(item.nextShiftAt))}`
                : 'Sin turnos próximos'
            }
            accessibilityHint="Muestra cómo llegar, el acceso y las rondas"
            onPress={() => setOpen(item.id)}
          />
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={loading && !!data}
          onRefresh={reload}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    />
  );
}

function SiteDetail({ site, onClose }: { site: GuardSite; onClose: () => void }) {
  const router = useRouter();
  return (
    <Card style={styles.detail}>
      <Text variant="heading">{site.name}</Text>
      <Text>{site.address}</Text>
      <Button
        label="Cómo llegar"
        accessibilityHint="Abre la app de mapas"
        onPress={() => void Linking.openURL(directionsUrl(site))}
      />
      <Field label="Acceso" value={site.accessInstructions ?? 'Sin indicaciones de acceso.'} />
      <Text variant="label" color="mutedForeground">
        Rondas
      </Text>
      {site.rounds.length === 0 && <Text>Sin rondas activas.</Text>}
      {site.rounds.map(({ name, checkpoints, versionId }) =>
        versionId ? (
          <Button
            key={versionId}
            variant="outline"
            label={`${name} (${checkpoints} puntos)`}
            accessibilityHint="Abre el recorrido en el mapa"
            onPress={() => router.push({ pathname: '/recorridos', params: { ids: versionId } })}
          />
        ) : (
          <Text key={name}>{`${name} (${checkpoints} puntos)`}</Text>
        ),
      )}
      <Field
        label="Supervisión"
        value={site.supervisors.join(', ') || 'Sin supervisor asignado.'}
      />
      <Button
        variant="ghost"
        label="Cerrar"
        accessibilityLabel={`Cerrar ${site.name}`}
        onPress={onClose}
      />
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text variant="label" color="mutedForeground">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  header: { gap: space[4], paddingBottom: space[4] },
  detail: { gap: space[3] },
  gap: { height: space[3] },
});

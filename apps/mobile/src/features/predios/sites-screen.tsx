import { useState } from 'react';
import { FlatList, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { SUSPENSION_MESSAGES, guardSitesSchema, type GuardSite } from '@garita/shared';
import { Banner, Button, Card, ListItem, Loading, Text, useTheme } from '@/ui';
import { cachedNotice, useCachedGet } from '@/lib/cached-get';

const nextFormat = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Abre la app de mapas con el recorrido hasta el predio. */
export const directionsUrl = ({ latitude, longitude }: Pick<GuardSite, 'latitude' | 'longitude'>) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

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
      <Field
        label="Rondas"
        value={
          site.rounds.map((r) => `${r.name} (${r.checkpoints} puntos)`).join('\n') ||
          'Sin rondas activas.'
        }
      />
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

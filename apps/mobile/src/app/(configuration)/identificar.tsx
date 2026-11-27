import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { radius, space } from '@garita/tokens';
import { identifiedNfcTagSchema, normalizeNfcUid, type IdentifiedNfcTag } from '@garita/shared';
import { Banner, Button, Icon, Screen, Text, useTheme } from '@/ui';
import { ApiError, apiRequest } from '@/lib/api-client';
import { cancelNfcRead, readNfcTag } from '@/lib/nfc';
import { NfcBlocker, useNfcState } from '@/features/etiquetas/nfc-status';
import { BackHeader, PointNumber } from '@/features/etiquetas/parts';

type State =
  | { kind: 'reading' }
  | { kind: 'found'; tag: IdentifiedNfcTag }
  | { kind: 'unknown' }
  | { kind: 'error'; message: string };

const DATE_TIME = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const date = (value: string) => DATE_TIME.format(new Date(value));
const READ_FAILED = 'No se pudo leer la etiqueta. Acercala de nuevo y no la muevas.';
const API_FAILED = 'No se pudo consultar la etiqueta. Revisá la conexión.';

/** Lee una etiqueta suelta y dice de qué punto y predio es: sirve para ordenar una pila mezclada. */
export default function IdentifyTagRoute() {
  const nfc = useNfcState();
  const [state, setState] = useState<State>({ kind: 'reading' });
  // Solo se lee mientras la pantalla espera una etiqueta: volver a activar NFC no pisa un resultado.
  const waiting = state.kind === 'reading';

  useEffect(() => {
    if (nfc !== 'ready' || !waiting) return;
    let active = true;
    readNfcTag()
      .then(
        ({ uid }) =>
          apiRequest('POST', '/etiquetas-nfc/identificar', identifiedNfcTagSchema, {
            uid: normalizeNfcUid(uid),
          }).catch((error: unknown) => {
            if (!active) return;
            setState(
              error instanceof ApiError && error.status === 404
                ? { kind: 'unknown' }
                : { kind: 'error', message: API_FAILED },
            );
          }),
        // La lectura falló antes de consultar la API: no es un problema de conexión.
        () => {
          if (active) setState({ kind: 'error', message: READ_FAILED });
        },
      )
      .then((tag) => {
        if (active && tag) setState({ kind: 'found', tag });
      })
      // Un UID que no se puede normalizar es una mala lectura, no un problema de conexión.
      .catch(() => {
        if (active) setState({ kind: 'error', message: READ_FAILED });
      })
      .finally(() => {
        // Una lectura vieja no corta la del intento nuevo.
        if (active) void cancelNfcRead();
      });
    return () => {
      active = false;
      void cancelNfcRead();
    };
  }, [nfc, waiting]);

  return (
    <Screen scroll>
      <BackHeader title="Identificar etiqueta" />
      <NfcBlocker state={nfc} />
      {nfc === 'ready' && (
        <>
          <View accessible accessibilityLiveRegion="polite">
            {state.kind === 'reading' && (
              <View style={styles.block}>
                <Text variant="heading">Acercá la etiqueta</Text>
                <Text>Apoyala en la parte de atrás del celular para ver de qué punto es.</Text>
              </View>
            )}
            {state.kind === 'found' && <TagResult tag={state.tag} />}
            {state.kind === 'unknown' && (
              <View style={styles.block}>
                <Text variant="heading">Etiqueta sin usar</Text>
                <Text>No está asociada a ningún punto. Podés usarla en cualquiera.</Text>
              </View>
            )}
            {state.kind === 'error' && <Banner tone="danger">{state.message}</Banner>}
          </View>
          {state.kind === 'found' && state.tag.status === 'active' && (
            <Button
              size="lg"
              label={`Ir a ${state.tag.site.name}`}
              onPress={() =>
                router.replace({
                  pathname: '/(configuration)/predio/[id]',
                  params: { id: state.tag.site.id, nombre: state.tag.site.name },
                })
              }
            />
          )}
          {state.kind !== 'reading' && (
            <Button
              variant="secondary"
              size="lg"
              label="Leer otra"
              onPress={() => setState({ kind: 'reading' })}
            />
          )}
        </>
      )}
    </Screen>
  );
}

function TagResult({ tag }: { tag: IdentifiedNfcTag }) {
  const { colors } = useTheme();
  const active = tag.status === 'active';
  const kind = tag.kind === 'secure' ? 'segura' : 'común';
  return (
    <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.foreground }]}>
      <View style={styles.row}>
        <PointNumber position={tag.checkpoint.position} done={active} />
        <View style={styles.flex}>
          <Text variant="title">{tag.checkpoint.name}</Text>
          <Text variant="subheading">{tag.site.name}</Text>
        </View>
      </View>
      {active ? (
        <>
          <View style={styles.row}>
            <Icon name="check" color="success" />
            <Text color="success" style={styles.flex}>
              {`Etiqueta ${kind} en uso desde el ${date(tag.associatedAt)}`}
            </Text>
          </View>
          <Text>
            {tag.lastReadAt
              ? `Último marcado de un vigilador: ${date(tag.lastReadAt)}`
              : 'Ningún vigilador la marcó todavía.'}
          </Text>
        </>
      ) : (
        <Banner tone="warning" title="Ya no está en uso">
          {`Fue ${tag.status === 'replaced' ? 'reemplazada' : 'quitada'}${tag.endedAt ? ` el ${date(tag.endedAt)}` : ''}. Podés asociarla a otro punto.`}
        </Banner>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[2] },
  result: { borderWidth: 1.5, borderRadius: radius.md, padding: space[4], gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
});

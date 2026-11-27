import { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, touch } from '@garita/tokens';
import { Button, Icon, Text, useTheme } from '@/ui';
import { NfcBlocker, type NfcState } from './nfc-status';
import { PointNumber, TAG_TEXT, type TagType } from './parts';
import { useTagAssociation, type TagPhase } from './use-tag-association';

export interface SheetPoint {
  id: string;
  name: string;
  position: number;
  tagType: TagType;
}

/** Fases que un cambio de NFC sobre el mismo punto no toca: un resultado o un guardado en curso. */
const SETTLED = new Set(['saving', 'done', 'removed', 'confirmRemove', 'move', 'error']);

/** Cuánto se ve el éxito antes de pasar solo al siguiente punto. */
const AUTO_DELAY_MS = 1500;

const pointName = (point: SheetPoint) => `${point.position} · ${point.name}`;

/**
 * Hoja de escaneo: todo lo que pasa con la etiqueta se ve acá, donde está el dedo. En serie
 * (`series`) recorre los pendientes; con `auto` pasa solo al siguiente después de asociar.
 */
export function ScanSheet({
  point,
  series,
  next,
  remaining,
  nfc,
  auto,
  onAutoChange,
  onNext,
  onClose,
  onChanged,
}: {
  point: SheetPoint | null;
  series: boolean;
  next: SheetPoint | null;
  /** Pendientes de la serie que quedan, contando el actual. */
  remaining: number;
  /** Sin NFC no se lee: la hoja lo avisa y no ofrece leer ni reintentar. */
  nfc: NfcState;
  auto: boolean;
  onAutoChange: (value: boolean) => void;
  /** Recibe el punto desde el que se avanza: un doble toque no saltea ninguno. */
  onNext: (fromId: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { phase, associate, confirmMove, askRemove, remove, reset } = useTagAssociation(onChanged);
  const ready = nfc === 'ready';
  const pointId = point?.id;
  const nextId = next?.id;
  const tagged = point ? point.tagType !== 'qr' : false;

  // Al abrir un punto sin etiqueta (o cualquiera de la serie) ya se espera la lectura.
  const shownId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const samePoint = shownId.current === pointId;
    shownId.current = pointId;
    if (!point) return reset();
    if (samePoint && SETTLED.has(phase.kind)) return;
    if (ready && (series || !tagged)) void associate(point);
    else reset();
    // Solo al cambiar de punto o de NFC: la lista se refresca después de cada asociación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, ready]);

  useEffect(() => {
    if (phase.kind !== 'done' || !series || !auto || !nextId) return;
    const timer = setTimeout(() => onNext(pointId ?? ''), AUTO_DELAY_MS);
    return () => clearTimeout(timer);
    // Por id: la lista se refresca tras asociar y `next` llega como objeto nuevo.
  }, [phase.kind, series, auto, pointId, nextId, onNext]);

  if (!point) return null;

  const close = () => {
    // Atrás de Android tampoco corta un guardado: la API ya puede haber aplicado el cambio.
    if (phase.kind === 'saving') return;
    reset();
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: colors.foreground }]}
        />
        <SafeAreaView
          edges={['bottom']}
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.foreground }]}
        >
          <View style={styles.pointRow}>
            <PointNumber position={point.position} done={phase.kind === 'done'} />
            <View style={styles.flex}>
              <Text variant="title">{point.name}</Text>
              {series && (
                <Text color="mutedForeground">
                  {remaining === 1 ? 'Último pendiente' : `Quedan ${remaining} pendientes`}
                </Text>
              )}
            </View>
          </View>

          {!ready && <NfcBlocker state={nfc} />}
          <PhaseMessage phase={phase} point={point} />

          {phase.kind === 'done' && (
            <View style={[styles.writeOn, { borderColor: colors.foreground }]}>
              <Text variant="label" color="mutedForeground">
                Escribí en la etiqueta
              </Text>
              <Text variant="display">{pointName(point)}</Text>
            </View>
          )}

          <View style={styles.actions}>
            {phase.kind === 'idle' && tagged && (
              <>
                {ready && (
                  <Button
                    size="lg"
                    label="Reemplazar etiqueta"
                    onPress={() => void associate(point)}
                  />
                )}
                <Button variant="danger" label="Quitar etiqueta" onPress={askRemove} />
              </>
            )}
            {phase.kind === 'confirmRemove' && (
              <>
                <Button
                  variant="danger"
                  size="lg"
                  label="Sí, quitar"
                  onPress={() => void remove(point)}
                />
                <Button variant="outline" label="No, volver" onPress={reset} />
              </>
            )}
            {phase.kind === 'move' && (
              <>
                <Button
                  size="lg"
                  label={`Mover a ${point.name}`}
                  onPress={() => void confirmMove(point)}
                />
                {ready && (
                  <Button
                    variant="outline"
                    label="Leer otra etiqueta"
                    onPress={() => void associate(point)}
                  />
                )}
              </>
            )}
            {phase.kind === 'error' && (phase.action === 'remove' || ready) && (
              <Button
                size="lg"
                label="Reintentar"
                onPress={() => void (phase.action === 'remove' ? remove(point) : associate(point))}
              />
            )}
            {phase.kind === 'done' && series && next && (
              <Button
                size="lg"
                label={auto ? `Pasando a ${pointName(next)}…` : `Siguiente: ${pointName(next)}`}
                accessibilityLabel={`Siguiente punto: ${pointName(next)}`}
                onPress={() => onNext(point.id)}
              />
            )}
            {(phase.kind === 'done' || phase.kind === 'removed') && (!series || !next) && (
              <Button size="lg" label="Listo" onPress={close} />
            )}
            {series && (
              <View style={styles.autoRow}>
                <Text variant="subheading" style={styles.flex} nativeID="auto-label">
                  Pasar solo al siguiente
                </Text>
                <Switch
                  accessibilityLabel="Pasar solo al siguiente"
                  accessibilityLabelledBy="auto-label"
                  value={auto}
                  onValueChange={onAutoChange}
                  trackColor={{ true: colors.primary, false: colors.input }}
                  thumbColor={colors.card}
                />
              </View>
            )}
            {/* Mientras se guarda no se cancela: la API ya puede haber aplicado el cambio. */}
            {phase.kind !== 'done' && phase.kind !== 'removed' && phase.kind !== 'saving' && (
              <Button variant="ghost" label={series ? 'Terminar' : 'Cancelar'} onPress={close} />
            )}
            {phase.kind === 'done' && series && next && (
              <Button variant="ghost" label="Terminar" onPress={close} />
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Qué pasa ahora, en grande; el lector de pantalla lo anuncia a medida que cambia. */
function PhaseMessage({ phase, point }: { phase: TagPhase; point: SheetPoint }) {
  const content = (() => {
    switch (phase.kind) {
      case 'idle':
        return {
          title: TAG_TEXT[point.tagType],
          body: 'Reemplazala si se dañó o se perdió. Para ver de qué punto es una etiqueta suelta, usá Identificar etiqueta.',
        };
      case 'reading':
        return {
          title: 'Acercá la etiqueta',
          body: 'Apoyala en la parte de atrás del celular y no la muevas.',
        };
      case 'configuring':
        return {
          title: 'Configurando etiqueta segura',
          body: `Paso ${phase.step}. No retires la etiqueta.`,
        };
      case 'proof':
        return {
          title: 'Acercala de nuevo',
          body: 'Es la lectura de prueba: confirma que la etiqueta quedó bien configurada.',
        };
      case 'saving':
        return { title: 'Guardando…' };
      case 'confirmRemove':
        return {
          title: `¿Quitar la etiqueta de ${point.name}?`,
          body: 'El punto queda sin etiqueta hasta que asocies otra.',
          icon: 'cross' as const,
          tone: 'danger' as const,
        };
      case 'move':
        return {
          title: `Esta etiqueta es de ${phase.otherName}`,
          body: `Si la movés, ${phase.otherName} queda sin etiqueta.`,
          icon: 'cross' as const,
          tone: 'warning' as const,
        };
      case 'done':
        return {
          title: phase.secure ? 'Etiqueta segura asociada' : 'Etiqueta asociada',
          icon: 'check' as const,
          tone: 'success' as const,
        };
      case 'removed':
        return {
          title: 'Etiqueta quitada',
          body: `${point.name} queda sin etiqueta hasta que asocies otra.`,
        };
      case 'error':
        return {
          title: phase.action === 'remove' ? 'No se pudo quitar' : 'No se pudo asociar',
          body: phase.message,
          icon: 'cross' as const,
          tone: 'danger' as const,
        };
    }
  })();
  return (
    <View accessibilityLiveRegion="polite" accessible style={styles.message}>
      <View style={styles.messageTitle}>
        {content.icon && <Icon name={content.icon} size={28} color={content.tone} />}
        <Text variant="heading" color={content.tone ?? 'foreground'} style={styles.flex}>
          {content.title}
        </Text>
      </View>
      {content.body && <Text>{content.body}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { opacity: 0.4 },
  sheet: {
    borderTopWidth: 1.5,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space[5],
    gap: space[5],
  },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
  message: { gap: space[2] },
  messageTitle: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  writeOn: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md, padding: space[4] },
  actions: { gap: space[3] },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: touch.min },
});

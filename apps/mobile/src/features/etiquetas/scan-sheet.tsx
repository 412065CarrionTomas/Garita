import { useEffect } from 'react';
import { Alert, Modal, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, touch } from '@garita/tokens';
import { Button, Icon, Text, useTheme } from '@/ui';
import { PointNumber, TAG_TEXT, type TagType } from './parts';
import { useTagAssociation, type TagPhase } from './use-tag-association';

export interface SheetPoint {
  id: string;
  name: string;
  position: number;
  tagType: TagType;
}

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
  auto: boolean;
  onAutoChange: (value: boolean) => void;
  onNext: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { phase, associate, confirmMove, remove, reset } = useTagAssociation(onChanged);
  const pointId = point?.id;
  const nextId = next?.id;
  const tagged = point ? point.tagType !== 'qr' : false;

  // Al abrir un punto sin etiqueta (o cualquiera de la serie) ya se espera la lectura.
  useEffect(() => {
    if (!point) return reset();
    if (series || !tagged) void associate(point);
    else reset();
    // Solo al cambiar de punto: la lista se refresca después de cada asociación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId]);

  useEffect(() => {
    if (phase.kind !== 'done' || !series || !auto || !nextId) return;
    const timer = setTimeout(onNext, AUTO_DELAY_MS);
    return () => clearTimeout(timer);
    // Por id: la lista se refresca tras asociar y `next` llega como objeto nuevo.
  }, [phase.kind, series, auto, nextId, onNext]);

  if (!point) return null;

  const close = () => {
    reset();
    onClose();
  };
  const confirmRemove = () =>
    Alert.alert(
      `¿Quitar la etiqueta de ${point.name}?`,
      'El punto queda sin etiqueta hasta que asocies otra.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => void remove(point) },
      ],
    );

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
                <Button
                  size="lg"
                  label="Reemplazar etiqueta"
                  onPress={() => void associate(point)}
                />
                <Button variant="danger" label="Quitar etiqueta" onPress={confirmRemove} />
              </>
            )}
            {phase.kind === 'move' && (
              <>
                <Button
                  size="lg"
                  label={`Mover a ${point.name}`}
                  onPress={() => void confirmMove(point)}
                />
                <Button
                  variant="outline"
                  label="Leer otra etiqueta"
                  onPress={() => void associate(point)}
                />
              </>
            )}
            {phase.kind === 'error' && (
              <Button size="lg" label="Reintentar" onPress={() => void associate(point)} />
            )}
            {phase.kind === 'done' && series && next && (
              <Button
                size="lg"
                label={auto ? `Pasando a ${pointName(next)}…` : `Siguiente: ${pointName(next)}`}
                accessibilityLabel={`Siguiente punto: ${pointName(next)}`}
                onPress={onNext}
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
            {phase.kind !== 'done' && phase.kind !== 'removed' && (
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
          title: 'No se pudo asociar',
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

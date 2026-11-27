import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { radius, space, touch } from '@garita/tokens';
import { Icon, Text, useTheme } from '@/ui';

export type TagType = 'qr' | 'nfc_basic' | 'nfc_secure';

export const TAG_TEXT: Record<TagType, string> = {
  qr: 'Sin etiqueta',
  nfc_basic: 'Etiqueta común',
  nfc_secure: 'Etiqueta segura',
};

/** Avance de etiquetado: la barra es apoyo, el texto de al lado dice el número. */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  // Acotada: un dato raro (más etiquetas que puntos) no desborda la barra.
  const ratio = total ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { backgroundColor: colors.muted }]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${Math.round(ratio * 100)}%`,
            backgroundColor: ratio >= 1 ? colors.success : colors.primary,
          },
        ]}
      />
    </View>
  );
}

/** Cabecera de las pantallas internas: volver y el título de la pantalla. */
export function BackHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(configuration)'))}
        style={styles.back}
      >
        <Icon name="back" size={24} />
      </Pressable>
      <Text variant="title" style={styles.flex}>
        {title}
      </Text>
    </View>
  );
}

/** N° del punto en el predio, en el mismo círculo que el mapa de la ronda. */
export function PointNumber({ position, done }: { position: number; done: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.number,
        done
          ? { backgroundColor: colors.success, borderColor: colors.success }
          : { borderColor: colors.foreground },
      ]}
    >
      <Text variant="numeral" color={done ? 'successForeground' : 'foreground'}>
        {position}
      </Text>
    </View>
  );
}

/** Estado de la etiqueta en texto de cuerpo con ícono: se lee de un vistazo y no solo por color. */
export function TagStatus({ type }: { type: TagType }) {
  const tagged = type !== 'qr';
  return (
    <View style={styles.status}>
      <Icon name={tagged ? 'check' : 'cross'} color={tagged ? 'success' : 'mutedForeground'} />
      <Text color={tagged ? 'success' : 'mutedForeground'}>{TAG_TEXT[type]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: space[2], borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  back: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  flex: { flex: 1 },
  number: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
});

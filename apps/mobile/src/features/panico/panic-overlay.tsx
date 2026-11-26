import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { space } from '@garita/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, useTheme } from '@/ui';
import {
  createDefaultFieldRepository,
  subscribePanicChanges,
  type LocalPanicAlert,
} from '@/lib/db/database';
import { fetchPanicState, resumePanicAlerts } from './transport';
import { triggerPanic } from './actions';

const HOLD_MS = 2000;
// Anillo de 112 con trazo de 6: piezas de tamaño fijo, como los casilleros de `src/ui`.
const RING = 112;
/** Alto que tapa el anillo sobre el contenido: las pantallas lo reservan abajo. */
export const PANIC_OVERLAY_SPACE = RING + space[5] * 2;
const STROKE = 6;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const smsMessages: Partial<Record<LocalPanicAlert['smsState'], string>> = {
  sent: 'SMS enviado',
  delivered: 'SMS entregado',
  prepared: 'SMS preparado, sin confirmación de entrega',
  failed: 'No se pudo enviar',
};

/** `bottomOffset` sube el anillo para que no tape la barra inferior del turno. */
export function PanicOverlay({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const [status, setStatus] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async (remote = false) => {
      const repository = await createDefaultFieldRepository();
      const shift = await repository.getShiftData();
      const shiftAlerts = (await repository.listPanicAlerts()).filter(
        (alert) => alert.request.shiftId === shift?.shift.id && !alert.blockedReason,
      );
      const resolved = shiftAlerts.findIndex((alert) => alert.state?.status === 'resolved');
      const alerts = resolved >= 0 ? shiftAlerts.slice(0, resolved) : shiftAlerts;
      const latest = alerts.find((alert) => alert.state !== null);
      if (!latest?.state) {
        const sms = alerts.find(
          (alert) => alert.request.shiftId === shift?.shift.id && !alert.blockedReason,
        );
        if (active) setStatus(sms ? (smsMessages[sms.smsState] ?? null) : null);
        return;
      }
      if (active)
        setStatus(
          latest.state.confirmedAt
            ? 'Confirmada por el supervisor'
            : 'Alerta recibida por la central',
        );
      if (remote && latest.state.status !== 'resolved') {
        const state = await fetchPanicState(latest.state.alertId).catch(() => latest.state);
        if (state && active) {
          if (JSON.stringify(state) !== JSON.stringify(latest.state))
            await repository.patchPanicAlert(latest.request.alertId, { state });
          setStatus(
            state.status === 'resolved'
              ? null
              : state.confirmedAt
                ? 'Confirmada por el supervisor'
                : 'Alerta recibida por la central',
          );
        }
      }
    };
    const unsubscribe = subscribePanicChanges(() => {
      void refresh().catch(() => undefined);
    });
    void resumePanicAlerts()
      .then(() => refresh(true))
      .catch(() => undefined);
    const interval = setInterval(() => {
      void refresh(true).catch(() => undefined);
    }, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const activate = () => {
    progress.stopAnimation();
    progress.setValue(0);
    void triggerPanic().catch(() => undefined);
  };
  return (
    <View
      style={[
        styles.overlay,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          bottom: insets.bottom + bottomOffset + space[5],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pánico, mantener presionado"
        accessibilityHint="Mantené presionado dos segundos para enviar una alerta silenciosa"
        accessibilityActions={[
          { name: 'activate', label: 'Activar pánico' },
          { name: 'longpress', label: 'Mantener presionado' },
        ]}
        onAccessibilityAction={(event) => {
          if (
            event.nativeEvent.actionName === 'activate' ||
            event.nativeEvent.actionName === 'longpress'
          )
            activate();
        }}
        onPressIn={() => {
          setHolding(true);
          progress.setValue(0);
          // Con Reducir movimiento no hay barrido: el anillo solo cambia de trazo mientras se mantiene.
          if (!reduceMotion)
            Animated.timing(progress, {
              toValue: 1,
              duration: HOLD_MS,
              useNativeDriver: false,
            }).start();
        }}
        onPressOut={() => {
          setHolding(false);
          progress.stopAnimation();
          progress.setValue(0);
        }}
        onLongPress={activate}
        delayLongPress={HOLD_MS}
        style={styles.ring}
      >
        <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            stroke={reduceMotion && holding ? colors.danger : colors.input}
            strokeWidth={STROKE / 2}
          />
          <AnimatedCircle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            stroke={colors.danger}
            strokeWidth={STROKE}
            strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]}
            strokeDashoffset={progress.interpolate({
              inputRange: [0, 1],
              outputRange: [CIRCUMFERENCE, 0],
            })}
            rotation={-90}
            origin={RING / 2 + ', ' + RING / 2}
          />
        </Svg>
        <Text variant="heading" accessibilityRole="none">
          Mantené
        </Text>
        <Text variant="caption" color="mutedForeground" accessibilityRole="none">
          {HOLD_MS / 1000} segundos
        </Text>
      </Pressable>
      {/* TODO(foja): "Cancelar alerta" y "Alerta enviada…" necesitan una acción de cancelación que hoy no existe en actions.ts. */}
      {status && (
        <Text
          variant="caption"
          color="mutedForeground"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: space[5],
    right: space[5],
    bottom: space[5],
    padding: space[2],
    borderWidth: 1,
    gap: space[1],
    alignItems: 'center',
  },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
});

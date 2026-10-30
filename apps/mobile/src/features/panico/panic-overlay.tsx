import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, useTheme } from '@/ui';
import {
  createDefaultFieldRepository,
  subscribePanicChanges,
  type LocalPanicAlert,
} from '@/lib/db/database';
import { fetchPanicState, resumePanicAlerts } from './transport';
import { triggerPanic } from './actions';

const smsMessages: Partial<Record<LocalPanicAlert['smsState'], string>> = {
  sent: 'SMS enviado',
  delivered: 'SMS entregado',
  prepared: 'SMS preparado, sin confirmación de entrega',
  failed: 'No se pudo enviar',
};

export function PanicOverlay() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async (remote = false) => {
      const repository = await createDefaultFieldRepository();
      const shift = await repository.getShiftData();
      const alerts = await repository.listPanicAlerts();
      const latest = alerts.find(
        (alert) => alert.request.shiftId === shift?.shift.id && alert.state !== null,
      );
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
            state.confirmedAt ? 'Confirmada por el supervisor' : 'Alerta recibida por la central',
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
          bottom: insets.bottom + space[5],
        },
      ]}
    >
      <Button
        label="Pánico"
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
          progress.setValue(0);
          Animated.timing(progress, { toValue: 1, duration: 2000, useNativeDriver: true }).start();
        }}
        onPressOut={() => {
          progress.stopAnimation();
          progress.setValue(0);
        }}
        onLongPress={activate}
        delayLongPress={2000}
        variant="danger"
        size="lg"
      />
      <Animated.View
        style={[
          styles.progress,
          { backgroundColor: colors.danger, transform: [{ scaleX: progress }] },
        ]}
      />
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
  },
  progress: { height: space[1] },
});

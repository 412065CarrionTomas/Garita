import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';
import { Button, Text, useTheme } from '@/ui';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { fetchPanicState, resumePanicAlerts } from './transport';
import { triggerPanic } from './actions';

export function PanicOverlay() {
  const { colors } = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const [status, setStatus] = useState<'received' | 'confirmed' | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const repository = await createDefaultFieldRepository();
      const latest = (await repository.listPanicAlerts())[0];
      if (!latest) return;
      const state = latest.state
        ? await fetchPanicState(latest.state.alertId).catch(() => latest.state)
        : null;
      if (state && active) {
        await repository.updatePanicAlert({ ...latest, state });
        setStatus(state.confirmedAt ? 'confirmed' : 'received');
      }
    };
    void resumePanicAlerts()
      .then(refresh)
      .catch(() => undefined);
    const interval = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const activate = () => {
    progress.stopAnimation();
    progress.setValue(0);
    void triggerPanic()
      .then(() => {
        // Server state is read on the next poll; no local success message is shown.
      })
      .catch(() => undefined);
  };
  return (
    <View style={[styles.overlay, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
        <Text variant="caption" color="mutedForeground" accessibilityLiveRegion="polite">
          {status === 'confirmed'
            ? 'Confirmada por el supervisor'
            : 'Alerta recibida por la central'}
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

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AccessibilityRole } from 'react-native';
import { radius, space } from '@garita/tokens';

import { Text } from './text';
import { toneColors, useTheme } from './theme';
import type { Tone } from './theme';

/**
 * Aviso dentro de la pantalla: error de un formulario, sin señal, escaneo rechazado.
 * Por defecto es un `alert` (el lector de pantalla lo anuncia); usar `role="text"` si es solo informativo.
 */
export function Banner({
  tone,
  title,
  children,
  action,
  role = 'alert',
  ...props
}: {
  tone: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: AccessibilityRole;
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(colors, tone);
  return (
    <View
      accessible
      accessibilityRole={role}
      {...props}
      style={[
        styles.banner,
        // Recuadro punteado para lo informativo o neutro; sólido para lo que pide acción.
        { backgroundColor: bg, borderColor: fg },
        (tone === 'info' || tone === 'neutral') && styles.dashed,
      ]}
    >
      {title ? (
        <Text variant="label" style={{ color: fg }} accessibilityRole="none">
          {title}
        </Text>
      ) : null}
      {typeof children === 'string' ? (
        <Text variant="body" style={{ color: fg }}>
          {children}
        </Text>
      ) : (
        children
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1.5],
  },
  dashed: { borderStyle: 'dashed' },
});

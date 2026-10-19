import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'signal' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  /** `lg` (56 px) es para la acción principal de la pantalla: se toca con guantes y en movimiento. */
  size?: 'md' | 'lg';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Botón de la app. Un solo `primary` o `signal` por pantalla. */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  style,
  accessibilityLabel,
  ...props
}: ButtonProps) {
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground, border: colors.secondary },
    outline: { bg: 'transparent', fg: colors.foreground, border: colors.input },
    danger: { bg: colors.danger, fg: colors.dangerForeground, border: colors.danger },
    signal: { bg: colors.signal, fg: colors.signalForeground, border: colors.signal },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const inactive = disabled === true || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      {...props}
      style={({ pressed }) => [
        styles.base,
        { minHeight: size === 'lg' ? touch.action : touch.min + 4 },
        { backgroundColor: palette.bg, borderColor: palette.border },
        inactive && styles.inactive,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text
          variant={size === 'lg' ? 'subheading' : 'label'}
          style={{ color: palette.fg, fontSize: size === 'lg' ? 18 : 16 }}
          accessibilityRole="none"
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
  },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

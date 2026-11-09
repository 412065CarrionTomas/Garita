import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  /** `lg` (56 px) es para la acción principal de la pantalla: se toca con guantes y en movimiento. */
  size?: 'md' | 'lg';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Botón de la app. Un solo `primary` por pantalla. `secondary` y `outline` son hoja con borde de
 * tinta; `danger` es borde y texto rojos (el relleno rojo se reserva a las fallas).
 */
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
    secondary: { bg: colors.card, fg: colors.foreground, border: colors.foreground },
    outline: { bg: colors.card, fg: colors.foreground, border: colors.input },
    danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.foreground, border: 'transparent' },
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
        { minHeight: size === 'lg' ? touch.action : touch.min },
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
          variant="label"
          style={{ color: palette.fg, fontSize: size === 'lg' ? 18 : 16, lineHeight: 22 }}
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
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
  },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

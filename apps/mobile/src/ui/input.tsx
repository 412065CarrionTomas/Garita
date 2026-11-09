import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { fontSize, radius, space, touch } from '@garita/tokens';

import { Text } from './text';
import { fontFamily, useTheme } from './theme';

export interface InputProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
  /** Acción pegada al campo, p. ej. "Mostrar" en una contraseña. */
  trailing?: ReactNode;
}

/** Campo con su etiqueta visible. La etiqueta también es el nombre accesible del campo. */
export function Input({
  label,
  hint,
  error,
  trailing,
  style,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : focused ? colors.ring : colors.input,
            borderWidth: focused ? 2 : 1.5,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          {...props}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            { color: colors.foreground, fontFamily: fontFamily.regular },
            style,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="mutedForeground">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1.5] },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch.min + 4,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
  },
  input: { flex: 1, fontSize: fontSize.base.size, paddingVertical: space[2] },
});

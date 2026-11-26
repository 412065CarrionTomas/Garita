import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { space } from '@garita/tokens';

import { useTheme } from './theme';

const EdgesContext = createContext<readonly Edge[] | undefined>(undefined);

/**
 * Bordes de zona segura que aplican las `Screen` de adentro. Un layout con cabecera y barra
 * propias ya cubre arriba y abajo, y así no se duplica el margen.
 */
export const ScreenEdges = EdgesContext.Provider;

/**
 * Base de toda pantalla: fondo del tema, zona segura y margen de 20 px. Con `scroll` el
 * contenido se desplaza y el teclado no tapa los campos. `style` aplica al contenedor del contenido.
 */
export function Screen({
  children,
  scroll = false,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const edges = useContext(EdgesContext);
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, style]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, styles.content, style]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space[5], gap: space[4] },
});

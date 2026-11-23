import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { faqForRole, groupFaqByTopic, LEGAL_OWNER, searchFaq } from '@garita/shared';
import type { FaqEntry } from '@garita/shared';
import { radius, space, touch } from '@garita/tokens';
import { Button, Input, Loading, Screen, Text, fontFamily, useTheme } from '@/ui';
import { useAuth } from '../auth/auth-context';

/** `**Botón**` → negrita; el resto, texto plano. */
function RichText({ text }: { text: string }) {
  return (
    <Text>
      {text.split('**').map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={styles.bold}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function FaqItem({ entry }: { entry: FaqEntry }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={entry.question}
        onPress={() => {
          setOpen((value) => !value);
        }}
        style={({ pressed }) => [styles.question, pressed && styles.pressed]}
      >
        <Text variant="subheading" accessibilityRole="none" style={styles.questionText}>
          {entry.question}
        </Text>
        <Text color="mutedForeground" importantForAccessibility="no">
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.answer}>
          {entry.answer.map((paragraph) => (
            <RichText key={paragraph} text={paragraph} />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Preguntas frecuentes. Viajan dentro de la app, así se leen sin señal. Sin sesión solo muestra lo
 * general; con sesión suma las del rol.
 */
export function FaqScreen() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState('');
  const entries = searchFaq(faqForRole(user?.role ?? null), query);
  const groups = groupFaqByTopic(entries);
  // Abierta en frío (enlace), espera la sesión para no mostrar primero la vista sin rol.
  if (loading)
    return (
      <Screen>
        <Loading label="Verificando sesión…" />
      </Screen>
    );
  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.back}>
        <Button
          variant="ghost"
          label="Volver"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        />
      </View>
      <Text variant="title">Preguntas frecuentes</Text>
      {!user && (
        <Text color="mutedForeground">
          Al iniciar sesión vas a ver también las preguntas de tu rol.
        </Text>
      )}
      <Input
        label="Buscar en las preguntas"
        value={query}
        onChangeText={setQuery}
        placeholder="Ej.: contraseña, turno, pánico"
        autoCorrect={false}
        returnKeyType="search"
      />
      {groups.length === 0 ? (
        <Text color="mutedForeground" accessibilityLiveRegion="polite">
          Sin resultados. Probá con otra palabra.
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.topic} style={styles.group}>
            <Text variant="label" color="mutedForeground" accessibilityRole="header">
              {group.topic}
            </Text>
            {group.entries.map((entry) => (
              <FaqItem key={entry.id} entry={entry} />
            ))}
          </View>
        ))
      )}
      <Text color="mutedForeground">¿Necesitás más ayuda? Escribinos a {LEGAL_OWNER.email}.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: space[4], paddingBottom: space[8] },
  back: { alignItems: 'flex-start' },
  group: { gap: space[2] },
  item: { borderWidth: 1, borderRadius: radius.md },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touch.action,
    padding: space[4],
  },
  questionText: { flex: 1 },
  pressed: { opacity: 0.85 },
  answer: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[4] },
  bold: { fontFamily: fontFamily.semibold },
});

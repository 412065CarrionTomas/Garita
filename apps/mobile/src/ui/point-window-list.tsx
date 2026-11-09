import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { radius, space } from '@garita/tokens';

import { Badge } from './badge';
import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

export type PointStatus = 'done' | 'late' | 'missed' | 'current' | 'pending';

export interface PointItem {
  id: string;
  /** Número del punto en la ronda (1, 2, …). */
  number: number;
  name: string;
  status: PointStatus;
  /** Hora registrada (done/late) o prevista (pending), ya formateada. */
  time?: string;
  /** Ventana horaria, solo se muestra en el punto actual. */
  window?: string;
}

const ROW = 76;
const VISIBLE = 5;
/** Opacidad según la distancia a la fila central: el desvanecido sin máscara ni dependencias. */
const FADE = [1, 0.8, 0.5];

function stampFor(item: PointItem) {
  switch (item.status) {
    case 'done':
      return { tone: 'neutral', label: item.time ?? 'Registrado', variant: 'solid' } as const;
    case 'late':
      return { tone: 'warning', label: item.time ?? 'Tarde', variant: 'solid' } as const;
    case 'missed':
      return { tone: 'danger', label: 'Sin registro', variant: 'solid' } as const;
    case 'current':
      return { tone: 'neutral', label: 'Ahora', variant: 'now' } as const;
    case 'pending':
      return { tone: 'neutral', label: item.time ?? 'Pendiente', variant: 'dashed' } as const;
  }
}

/**
 * La ronda en una ventana de cinco filas (dos anteriores, la actual y dos siguientes) que se
 * desliza, sirva para 6 o para 40 puntos. Al cambiar `currentIndex` vuelve sola al punto actual.
 * Las filas lejanas del centro se atenúan bajando su opacidad.
 */
export function PointWindowList({
  points,
  currentIndex,
}: {
  points: PointItem[];
  currentIndex: number;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollView>(null);
  const [center, setCenter] = useState(currentIndex);

  useEffect(() => {
    scroll.current?.scrollTo({ y: currentIndex * ROW, animated: true });
  }, [currentIndex]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.y / ROW) + Math.floor(VISIBLE / 2);
    setCenter((previous) => (previous === next ? previous : next));
  };

  // Margen arriba y abajo para que el primer y el último punto también puedan quedar al centro.
  const pad = Math.floor(VISIBLE / 2) * ROW;
  return (
    <ScrollView
      ref={scroll}
      style={{ height: ROW * VISIBLE }}
      contentContainerStyle={{ paddingVertical: pad }}
      onScroll={onScroll}
      scrollEventThrottle={32}
      snapToInterval={ROW}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      accessibilityLabel="Puntos de la ronda"
    >
      {points.map((item, index) => {
        const isCurrent = item.status === 'current';
        const stamp = stampFor(item);
        const cross = item.status === 'missed';
        const tick = item.status === 'done' || item.status === 'late';
        return (
          <View
            key={item.id}
            accessible
            accessibilityLabel={`Punto ${item.number}, ${item.name}, ${stamp.label}`}
            style={[
              styles.row,
              { borderColor: isCurrent ? colors.foreground : colors.border },
              isCurrent && styles.current,
              { opacity: FADE[Math.min(Math.abs(index - center), FADE.length - 1)] },
            ]}
          >
            <Text variant="numeral" color="mutedForeground" style={styles.number}>
              {item.number}
            </Text>
            <View
              style={[
                styles.box,
                { borderColor: cross ? colors.danger : colors.foreground },
                tick && { backgroundColor: colors.foreground },
              ]}
            >
              {tick ? <Icon name="check" size={16} color="primaryForeground" /> : null}
              {cross ? <Icon name="cross" size={16} color="danger" /> : null}
            </View>
            <View style={styles.texts}>
              <Text variant="subheading" numberOfLines={1}>
                {item.name}
              </Text>
              {isCurrent && item.window ? (
                <Text variant="caption" color="mutedForeground" numberOfLines={1}>
                  Ventana {item.window}
                </Text>
              ) : null}
            </View>
            <Badge {...stamp} />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderBottomWidth: 1,
    paddingHorizontal: space[2],
  },
  // La fila actual va enmarcada: recuadro interior de 2 px en tinta.
  current: { borderWidth: 2, borderRadius: radius.md },
  number: { width: 28, textAlign: 'right' },
  box: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, gap: space[0.5] },
});

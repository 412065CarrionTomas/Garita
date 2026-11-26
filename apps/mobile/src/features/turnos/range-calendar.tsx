import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { space, touch } from '@garita/tokens';
import { Icon, Text, useTheme } from '@/ui';
import { isoDay, type DayRange } from './shift-range';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' });

/**
 * Calendario de un mes para elegir un rango: el primer toque fija el inicio y el segundo el fin.
 * Los días con turno llevan un punto.
 */
export function RangeCalendar({
  range,
  marked,
  onChange,
}: {
  range: DayRange;
  marked: Set<string>;
  onChange: (range: DayRange) => void;
}) {
  const { colors } = useTheme();
  const [month, setMonth] = useState(() => new Date(`${range.desde}T12:00:00`));
  const [anchor, setAnchor] = useState<string | null>(null);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // semana desde el lunes
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: lead + length }, (_, i) =>
    i < lead ? null : new Date(first.getFullYear(), first.getMonth(), i - lead + 1),
  );
  const pick = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      return onChange({ desde: day, hasta: day });
    }
    setAnchor(null);
    onChange(day < anchor ? { desde: day, hasta: anchor } : { desde: anchor, hasta: day });
  };
  const step = (offset: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  return (
    <View>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mes anterior"
          onPress={() => step(-1)}
          style={styles.cell}
        >
          <Icon name="back" />
        </Pressable>
        <Text variant="label">{monthName.format(month)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mes siguiente"
          onPress={() => step(1)}
          style={styles.cell}
        >
          <Icon name="forward" />
        </Pressable>
      </View>
      <Text variant="caption" color="mutedForeground" style={styles.hint}>
        {anchor ? 'Tocá el último día del rango.' : 'Tocá el primer día del rango.'}
      </Text>
      <View style={styles.grid}>
        {WEEKDAYS.map((label, i) => (
          <Text key={i} variant="caption" color="mutedForeground" style={styles.weekday}>
            {label}
          </Text>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={i} style={styles.cell} />;
          const day = isoDay(date);
          const selected = day >= range.desde && day <= range.hasta;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`${dayName.format(date)}${marked.has(day) ? ', con turno' : ''}`}
              accessibilityState={{ selected }}
              onPress={() => pick(day)}
              style={[styles.cell, selected && { backgroundColor: colors.primary }]}
            >
              <Text color={selected ? 'primaryForeground' : 'foreground'}>{date.getDate()}</Text>
              {marked.has(day) && (
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: selected ? colors.primaryForeground : colors.foreground },
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CELL = `${100 / 7}%` as const;
const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space[2] },
  weekday: { width: CELL, textAlign: 'center' },
  cell: { width: CELL, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  dot: { width: space[1], height: space[1], borderRadius: space[1] },
});

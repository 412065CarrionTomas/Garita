import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { space, touch } from '@garita/tokens';
import { Icon, Text, useTheme } from '@/ui';
import { isoDay, type DayRange } from './shift-range';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' });

/**
 * Calendario de un mes para elegir un día. Sombrea el rango vigente, resalta hoy y marca con un
 * punto los días con turno.
 */
export function DateCalendar({
  value,
  range,
  marked,
  onPick,
}: {
  value: string;
  range: DayRange;
  marked: Set<string>;
  onPick: (day: string) => void;
}) {
  const { colors } = useTheme();
  const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`));
  const today = isoDay(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // semana desde el lunes
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: lead + length }, (_, i) =>
    i < lead ? null : new Date(first.getFullYear(), first.getMonth(), i - lead + 1),
  );
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
      <View style={styles.grid}>
        {WEEKDAYS.map((label, i) => (
          <Text key={i} variant="caption" color="mutedForeground" style={styles.weekday}>
            {label}
          </Text>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={i} style={styles.cell} />;
          const day = isoDay(date);
          const picked = day === value;
          const inRange = day >= range.desde && day <= range.hasta;
          const isToday = day === today;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`${dayName.format(date)}${isToday ? ', hoy' : ''}${marked.has(day) ? ', con turno' : ''}`}
              accessibilityState={{ selected: picked }}
              onPress={() => onPick(day)}
              style={[
                styles.cell,
                inRange && { backgroundColor: colors.muted },
                isToday && [styles.today, { borderColor: colors.info }],
                picked && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                variant={isToday ? 'label' : 'body'}
                color={picked ? 'primaryForeground' : isToday ? 'info' : 'foreground'}
              >
                {date.getDate()}
              </Text>
              {marked.has(day) && (
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: picked ? colors.primaryForeground : colors.foreground },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space[2] },
  weekday: { width: CELL, textAlign: 'center' },
  cell: { width: CELL, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderRadius: space[1] },
  dot: { width: space[1], height: space[1], borderRadius: space[1] },
});

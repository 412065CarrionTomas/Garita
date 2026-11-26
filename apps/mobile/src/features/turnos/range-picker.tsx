import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, touch } from '@garita/tokens';
import { Text, useTheme } from '@/ui';
import { DateCalendar } from './date-calendar';
import { formatDate } from './shift-row';
import type { DayRange } from './shift-range';

/** Rango con dos campos: cada uno abre el calendario para elegir su propio día. */
export function RangePicker({
  range,
  marked,
  onChange,
}: {
  range: DayRange;
  marked: Set<string>;
  onChange: (range: DayRange) => void;
}) {
  const [editing, setEditing] = useState<keyof DayRange | null>(null);
  return (
    <>
      <View style={styles.fields}>
        {(['desde', 'hasta'] as const).map((field) => (
          <DateField
            key={field}
            label={field === 'desde' ? 'Desde' : 'Hasta'}
            value={formatDate(range[field])}
            active={editing === field}
            onPress={() => setEditing(editing === field ? null : field)}
          />
        ))}
      </View>
      {editing && (
        <DateCalendar
          key={editing}
          value={range[editing]}
          range={range}
          marked={marked}
          onPick={(day) => {
            // Si el día deja el rango invertido, el otro extremo lo acompaña.
            const next = { ...range, [editing]: day };
            if (next.desde > next.hasta) next[editing === 'desde' ? 'hasta' : 'desde'] = day;
            onChange(next);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function DateField({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={active ? 'Cierra el calendario' : 'Abre el calendario para elegir el día'}
      accessibilityState={{ expanded: active }}
      onPress={onPress}
      style={[
        styles.field,
        { borderColor: colors.foreground },
        active && { backgroundColor: colors.foreground },
      ]}
    >
      <Text variant="caption" color={active ? 'background' : 'mutedForeground'}>
        {label}
      </Text>
      <Text variant="label" color={active ? 'background' : 'foreground'}>
        {value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fields: { flexDirection: 'row', gap: space[3] },
  field: {
    flex: 1,
    minHeight: touch.min,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderWidth: 1.5,
    borderRadius: radius.lg,
  },
});

import { CategoryChart } from '../category-chart';
import { categoryPresentation, shiftStatusRows } from '../summary-rows';
import { useShiftsToday } from '../queries';
import { WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

export function ShiftsTodayWidget({ item }: WidgetProps) {
  const shifts = useShiftsToday();
  const link = { to: '/supervision', label: 'En vivo' };
  if (!shifts.data)
    return (
      <WidgetFrame title="Turnos de hoy" link={link}>
        <WidgetStatus query={shifts} label="los turnos de hoy" />
      </WidgetFrame>
    );
  return (
    <WidgetFrame
      title="Turnos de hoy"
      link={link}
      aside={<span className="t-label text-muted-foreground">{shifts.data.length} en total</span>}
    >
      <CategoryChart
        rows={shiftStatusRows(shifts.data)}
        presentation={categoryPresentation(item.presentation)}
        caption="Turnos de hoy por estado"
        valueLabel="Turnos"
      />
    </WidgetFrame>
  );
}

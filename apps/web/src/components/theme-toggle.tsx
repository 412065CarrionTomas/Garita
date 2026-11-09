import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/lib/theme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'light', label: 'Tema claro', Icon: SunIcon },
  { mode: 'system', label: 'Tema del sistema', Icon: MonitorIcon },
  { mode: 'dark', label: 'Tema oscuro', Icon: MoonIcon },
];

/** Selector de tema de tres posiciones, pensado para la barra de tinta (siempre oscura). */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="group"
      aria-label="Tema de la interfaz"
      className={cn('flex rounded-md border-[1.5px] border-bar-muted', className)}
    >
      {OPTIONS.map(({ mode: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          aria-label={label}
          aria-pressed={mode === option}
          onClick={() => {
            setMode(option);
          }}
          className={cn(
            'flex size-8 items-center justify-center text-bar-muted outline-none first:rounded-l-sm last:rounded-r-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-bar-foreground',
            mode === option ? 'bg-bar-foreground text-bar' : 'hover:text-bar-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

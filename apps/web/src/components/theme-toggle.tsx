import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/lib/theme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'light', label: 'Tema claro', Icon: SunIcon },
  { mode: 'system', label: 'Tema del sistema', Icon: MonitorIcon },
  { mode: 'dark', label: 'Tema oscuro', Icon: MoonIcon },
];

/** Selector de tema de tres posiciones. Se ve bien sobre el sidebar (siempre oscuro). */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="group"
      aria-label="Tema de la interfaz"
      className={cn('flex rounded-lg bg-sidebar-accent/60 p-0.5', className)}
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
            'flex h-8 flex-1 items-center justify-center rounded-md text-sidebar-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mode === option
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'hover:text-sidebar-accent-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

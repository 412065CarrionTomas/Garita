import { cn } from '@/lib/utils';

/**
 * Control segmentado: chips pegados que comparten borde, seleccionado invertido. Sirve de filtro
 * y de selector de vista (texto por botón, nunca solo ícono).
 */
export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented-filter"
      className={cn('flex', className)}
    >
      {options.map((o) => {
        const pressed = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              onChange(o.value);
            }}
            className={cn(
              'relative min-h-9 border-[1.5px] px-3.5 text-sm font-semibold transition-colors first:rounded-l-md last:rounded-r-md not-first:-ml-[1.5px]',
              pressed
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input text-foreground hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

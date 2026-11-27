import type { SpeedProfile } from '@garita/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

/** Velocidad propia de la ronda; vacía (''), la del predio. Los km/h solo con «Personalizada». */
export function SpeedField({
  speed,
  kmh,
  errors,
  onSpeedChange,
  onKmhChange,
}: {
  speed: SpeedProfile | '';
  /** Texto del campo: puede quedar vacío mientras se escribe; la validación es al guardar. */
  kmh: string;
  errors?: string[];
  onSpeedChange: (speed: SpeedProfile | '') => void;
  onKmhChange: (kmh: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="round-speed">Velocidad</Label>
      <div className="flex items-center gap-2">
        <NativeSelect
          id="round-speed"
          value={speed}
          onChange={(event) => {
            onSpeedChange(event.target.value as SpeedProfile | '');
          }}
        >
          <NativeSelectOption value="">La del predio</NativeSelectOption>
          <NativeSelectOption value="walking">A pie (10 km/h)</NativeSelectOption>
          <NativeSelectOption value="bicycle">Bicicleta (25 km/h)</NativeSelectOption>
          <NativeSelectOption value="vehicle">Vehículo (60 km/h)</NativeSelectOption>
          <NativeSelectOption value="custom">Personalizada</NativeSelectOption>
        </NativeSelect>
        {speed === 'custom' && (
          <Input
            type="number"
            aria-label="Velocidad personalizada (km/h)"
            aria-invalid={Boolean(errors)}
            aria-describedby={errors ? 'round-speed-error' : undefined}
            min={5}
            max={120}
            value={kmh}
            onChange={(event) => {
              onKmhChange(event.target.value);
            }}
            className="w-20"
          />
        )}
      </div>
      {errors?.map((error, i) => (
        <p
          className="text-sm text-danger"
          id={i === 0 ? 'round-speed-error' : undefined}
          key={`${String(i)}-${error}`}
        >
          {error}
        </p>
      ))}
    </div>
  );
}

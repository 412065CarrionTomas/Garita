import type { GuardSelection, GuardSelectionRequired } from '@garita/shared';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export function GuardSelectionStep({
  required,
  value,
  onChange,
}: {
  required: GuardSelectionRequired;
  value: GuardSelection;
  onChange: (selection: GuardSelection) => void;
}) {
  const kept = new Set(value.guardsToKeep);
  return (
    <fieldset className="space-y-4">
      <legend className="t-title">Elegí qué vigiladores siguen activos</legend>
      <p role="status">
        {kept.size} de {required.maxGuards}
      </p>
      <p className="text-sm text-muted-foreground">
        Los demás se desactivan al confirmarse la autorización o el pago. Si tienen un turno en
        curso, siguen activos hasta que cierre y se ejecute el barrido (hasta cinco minutos).
      </p>
      {required.guards.map((guard) => {
        const decision = value.shiftDecisions.find((d) => d.guardId === guard.id);
        return (
          <div key={guard.id} className="space-y-2 rounded-md border p-3">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={kept.has(guard.id)}
                disabled={!kept.has(guard.id) && kept.size >= required.maxGuards}
                onChange={(event) => {
                  const guardsToKeep = event.target.checked
                    ? [...value.guardsToKeep, guard.id]
                    : value.guardsToKeep.filter((id) => id !== guard.id);
                  onChange({
                    guardsToKeep,
                    shiftDecisions: required.guards
                      .filter((g) => !guardsToKeep.includes(g.id))
                      .map((g) => {
                        const previous = value.shiftDecisions.find((d) => d.guardId === g.id);
                        return previous &&
                          (previous.shiftAction !== 'derive' ||
                            guardsToKeep.includes(previous.deriveToUserId))
                          ? previous
                          : {
                              guardId: g.id,
                              shiftAction: 'unassign',
                              confirmUnassignedCount: g.futureShiftCount,
                            };
                      }),
                  });
                }}
              />
              {guard.name}
            </Label>
            {!kept.has(guard.id) && (
              <>
                <Label htmlFor={`shift-action-${guard.id}`}>
                  Turnos de {guard.name} ({guard.futureShiftCount} futuros)
                </Label>
                <NativeSelect
                  id={`shift-action-${guard.id}`}
                  value={decision?.shiftAction === 'derive' ? decision.deriveToUserId : ''}
                  onChange={(event) => {
                    const target = event.target.value;
                    onChange({
                      ...value,
                      shiftDecisions: value.shiftDecisions
                        .filter((d) => d.guardId !== guard.id)
                        .concat(
                          target
                            ? { guardId: guard.id, shiftAction: 'derive', deriveToUserId: target }
                            : {
                                guardId: guard.id,
                                shiftAction: 'unassign',
                                confirmUnassignedCount: guard.futureShiftCount,
                              },
                        ),
                    });
                  }}
                >
                  <NativeSelectOption value="">Dejarlos sin vigilador</NativeSelectOption>
                  {required.guards
                    .filter((g) => kept.has(g.id))
                    .map((target) => (
                      <NativeSelectOption key={target.id} value={target.id}>
                        Derivar sus turnos a {target.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

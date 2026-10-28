import { windowOwner, type AssignmentOwnerSource } from './assignments';

const pedro: AssignmentOwnerSource = {
  id: 'pedro',
  startsAt: '2026-11-11T23:00:00.000Z',
  result: 'absent',
};
const juan: AssignmentOwnerSource = {
  id: 'juan',
  startsAt: '2026-11-12T00:00:00.000Z',
  result: 'started',
};

describe('windowOwner', () => {
  it('asigna la ventana a la asignación vigente cuando termina', () => {
    expect(windowOwner('2026-11-11T23:30:00.000Z', [pedro, juan])).toBe('pedro');
    expect(windowOwner('2026-11-12T01:00:00.000Z', [pedro, juan])).toBe('juan');
  });

  it('deja en la asignación anterior la ventana que termina justo a la hora del reemplazo', () => {
    expect(windowOwner('2026-11-12T00:00:00.000Z', [juan, pedro])).toBe('pedro');
  });

  it('ignora la asignación reemplazada antes de su hora de inicio', () => {
    const replaced: AssignmentOwnerSource = { ...juan, id: 'ana', result: 'replaced' };
    expect(windowOwner('2026-11-12T01:00:00.000Z', [pedro, replaced])).toBe('pedro');
  });

  it('cruza la medianoche y devuelve null antes de la primera asignación', () => {
    expect(windowOwner('2026-11-12T05:00:00.000Z', [pedro])).toBe('pedro');
    expect(windowOwner('2026-11-11T23:00:00.000Z', [pedro])).toBeNull();
  });
});

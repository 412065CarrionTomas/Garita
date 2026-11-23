import {
  applyOrder,
  availableActions,
  moveId,
  mergeVisibleOrder,
  moveIdTo,
  partitionPinned,
  pin,
  unpin,
} from './reorder';

const ids = Object.freeze(['a', 'b', 'c', 'd']);

describe('moveId y moveIdTo', () => {
  it('mueve arriba de todo, uno arriba, uno abajo y al final', () => {
    expect(moveId(ids, 'c', 'top')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveId(ids, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveId(ids, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveId(ids, 'a', 'bottom')).toEqual(['b', 'c', 'd', 'a']);
  });

  it('devuelve la misma referencia si no hay movimiento posible', () => {
    expect(moveId(ids, 'a', 'top')).toBe(ids);
    expect(moveId(ids, 'a', 'up')).toBe(ids);
    expect(moveId(ids, 'd', 'down')).toBe(ids);
    expect(moveId(ids, 'z', 'top')).toBe(ids);
    expect(moveIdTo(ids, 'b', 1)).toBe(ids);
  });

  it('recorta el destino al rango de la lista', () => {
    expect(moveIdTo(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveIdTo(ids, 'd', -5)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveIdTo(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ofrece solo las acciones con efecto', () => {
    expect(availableActions(ids, 'a')).toEqual(['down', 'bottom']);
    expect(availableActions(ids, 'b')).toEqual(['top', 'up', 'down', 'bottom']);
    expect(availableActions(ids, 'd')).toEqual(['top', 'up']);
    expect(availableActions(['a'], 'a')).toEqual([]);
    expect(availableActions(ids, 'z')).toEqual([]);
  });
});

describe('fijar y quitar', () => {
  it('fija arriba o al final, y si ya estaba solo lo mueve', () => {
    expect(pin(['a'], 'b')).toEqual(['b', 'a']);
    expect(pin(['a'], 'b', 'bottom')).toEqual(['a', 'b']);
    expect(pin(['a', 'b'], 'b', 'top')).toEqual(['b', 'a']);
  });

  it('no supera el máximo y quitar es idempotente', () => {
    const full = ['a', 'b'];
    expect(pin(full, 'c', 'top', 2)).toBe(full);
    expect(unpin(full, 'a')).toEqual(['b']);
    expect(unpin(full, 'z')).toBe(full);
  });
});

interface Row {
  id: string;
}
const rows: Row[] = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const getId = (row: Row) => row.id;
const idsOf = (list: Row[]) => list.map(getId);

describe('partitionPinned', () => {
  it('separa los fijados en su orden y omite los que no están en la lista', () => {
    const { pinned, rest } = partitionPinned(rows, ['c', 'fuera', 'a'], getId);
    expect(idsOf(pinned)).toEqual(['c', 'a']);
    expect(idsOf(rest)).toEqual(['b', 'd']);
  });
});

describe('applyOrder', () => {
  it('aplica el orden de sesión y deja al final, en su orden, a los nuevos', () => {
    const later = [...rows, { id: 'e' }, { id: 'f' }];
    expect(idsOf(applyOrder(later, ['d', 'b', 'a', 'c'], getId))).toEqual([
      'd',
      'b',
      'a',
      'c',
      'e',
      'f',
    ]);
  });

  it('ignora ids que ya no están y sin orden respeta el de los datos', () => {
    expect(idsOf(applyOrder(rows, ['x', 'c'], getId))).toEqual(['c', 'a', 'b', 'd']);
    expect(idsOf(applyOrder(rows, [], getId))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('mergeVisibleOrder', () => {
  it('reordena los visibles y deja a los ocultos en su lugar', () => {
    // b y d no se ven: el usuario invirtió a, c y e.
    expect(mergeVisibleOrder(['a', 'b', 'c', 'd', 'e'], ['e', 'c', 'a'])).toEqual([
      'e',
      'b',
      'c',
      'd',
      'a',
    ]);
  });

  it('sin cambios devuelve la misma referencia', () => {
    const full = ['a', 'b', 'c'];
    expect(mergeVisibleOrder(full, ['a', 'c'])).toBe(full);
  });
});

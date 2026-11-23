import { act, renderHook } from '@testing-library/react';

import { useBusy } from './use-busy';

describe('useBusy', () => {
  it('ignora una segunda ejecución mientras la primera está en curso', async () => {
    const { result } = renderHook(() => useBusy());
    let release!: () => void;
    let calls = 0;
    const task = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    let first!: Promise<void>;
    act(() => {
      first = result.current.run(task);
      void result.current.run(task);
    });
    expect(calls).toBe(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});

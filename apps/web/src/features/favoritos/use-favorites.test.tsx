import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { apiGet, apiPut } from '@/lib/api-client';
import { useFavorites } from './use-favorites';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPut: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFavorites('admin-summary', 'site'), { wrapper });
}

beforeEach(() => {
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiPut).mockReset();
});

it('no guarda nada hasta haber leído los fijados de la base', async () => {
  const read = deferred<{ ids: string[] }>();
  jest.mocked(apiGet).mockReturnValue(read.promise);
  const { result } = setup();
  expect(result.current.ready).toBe(false);
  act(() => {
    result.current.update(['b'], 'b quedó fijado.');
  });
  expect(apiPut).not.toHaveBeenCalled();
  read.resolve({ ids: ['a'] });
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  expect(result.current.ids).toEqual(['a']);
});

it('manda los cambios en fila y un error viejo no pisa al cambio que sí se guardó', async () => {
  jest.mocked(apiGet).mockResolvedValue({ ids: ['a'] });
  const first = deferred<{ ids: string[] }>();
  const second = deferred<{ ids: string[] }>();
  jest.mocked(apiPut).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = setup();
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.update(['b', 'a'], 'b quedó fijado.');
  });
  act(() => {
    result.current.update(['c', 'b', 'a'], 'c quedó fijado.');
  });
  // El segundo espera a que termine el primero.
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    first.reject(new Error('caída'));
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(2);
  });
  await act(async () => {
    second.resolve({ ids: ['c', 'b', 'a'] });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(result.current.ids).toEqual(['c', 'b', 'a']);
  });
  expect(result.current.notice).toEqual({ message: 'c quedó fijado.', failed: false });
});

it('si falla deshacer lo avisa aunque el aviso ya se haya cerrado', async () => {
  jest.mocked(apiGet).mockResolvedValue({ ids: ['a'] });
  jest
    .mocked(apiPut)
    .mockResolvedValueOnce({ ids: ['b', 'a'] })
    .mockRejectedValueOnce(new Error('caída'));
  const { result } = setup();
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.update(['b', 'a'], 'b quedó fijado.');
  });
  await waitFor(() => {
    expect(result.current.ids).toEqual(['b', 'a']);
  });
  act(() => {
    result.current.undo();
  });
  await waitFor(() => {
    expect(result.current.notice).toEqual({
      message: 'No pudimos guardar el cambio.',
      failed: true,
    });
  });
});

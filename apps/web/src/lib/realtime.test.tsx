import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRealtime } from './realtime';

const mockListeners = new Map<string, (value?: unknown) => void>();
const mockSocket = {
  on: jest.fn((name: string, listener: (value?: unknown) => void) => {
    mockListeners.set(name, listener);
  }),
  io: { on: jest.fn() },
  auth: {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
};
jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } },
}));
jest.mock('@/config/env', () => ({ env: { VITE_API_URL: 'http://localhost:3000/api/v1' } }));

function Probe({ onRender }: { onRender?: (rt: ReturnType<typeof useRealtime>) => void }) {
  const realtime = useRealtime(true);
  onRender?.(realtime);
  return (
    <>
      <p>{realtime.connected ? 'Conectado' : 'Reconectando…'}</p>
      <p>{realtime.incident}</p>
      <p>{realtime.announcement}</p>
      {realtime.incident && (
        <button type="button" onClick={realtime.dismissIncident}>
          Cerrar
        </button>
      )}
    </>
  );
}

it('invalida las consultas por registro y recarga todo al reconectar', async () => {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockSocket.connect).toHaveBeenCalled();
  act(() => mockListeners.get('connect')?.());
  expect(screen.getByText('Conectado')).toBeInTheDocument();
  act(() =>
    mockListeners.get('registro.nuevo')?.({
      shiftId: 's1',
      siteId: 'p1',
      checkpointId: 'c1',
      recordId: 'r1',
    }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['supervision'] });
  invalidate.mockClear();
  act(() => mockListeners.get('disconnect')?.());
  expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  act(() => mockListeners.get('connect')?.());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['supervision'] });
});

it('muestra aviso de incidente con predio, anuncia y permite cerrarlo', async () => {
  const client = new QueryClient();
  client.setQueryData(['supervision', 'turnos'], [
    { site: { id: 'p1', name: 'Depósito Central' } },
  ]);
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    mockListeners.get('incidente.nuevo')?.({
      incidentId: 'i-1',
      siteId: 'p1',
    });
  });
  expect(screen.getByText('Incidente nuevo en Depósito Central')).toBeInTheDocument();
  act(() => {
    screen.getByRole('button', { name: 'Cerrar' }).click();
  });
  expect(screen.queryByText('Incidente nuevo en Depósito Central')).not.toBeInTheDocument();
});

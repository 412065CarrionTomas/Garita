import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  SOCKET_NAMESPACE,
  incidentNewEventSchema,
  noticeNewEventSchema,
  recordNewEventSchema,
  shiftUpdatedEventSchema,
} from '@garita/shared';
import { auth } from '@/lib/firebase';
import { env } from '@/config/env';
import type { ShiftDetail, ShiftRow } from '@/features/supervision/contracts';

export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [incident, setIncident] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!enabled) return;
    const socket = io(`${new URL(env.VITE_API_URL).origin}${SOCKET_NAMESPACE}`, {
      autoConnect: false,
      reconnection: true,
      auth: (callback) => {
        void (auth.currentUser?.getIdToken() ?? Promise.resolve('')).then((token) => {
          callback({ token });
        });
      },
    });
    let connectedOnce = false;
    socket.on('connect', () => {
      setConnected(true);
      if (connectedOnce) {
        void queryClient.invalidateQueries({ queryKey: ['supervision'] });
        void queryClient.invalidateQueries({ queryKey: ['revision'] });
      }
      connectedOnce = true;
      setAnnouncement('Supervisión conectada');
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setAnnouncement('Supervisión reconectando');
    });
    socket.on(REALTIME_EVENTS.shiftUpdated, (raw: unknown) => {
      const event = shiftUpdatedEventSchema.safeParse(raw);
      if (!event.success) return;
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      void queryClient.invalidateQueries({ queryKey: ['revision'] });
      setAnnouncement(`Turno actualizado`);
    });
    socket.on(REALTIME_EVENTS.recordNew, (raw: unknown) => {
      const event = recordNewEventSchema.safeParse(raw);
      if (!event.success) return;
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      void queryClient.invalidateQueries({ queryKey: ['revision'] });
      setAnnouncement('Registro nuevo en un turno');
    });
    socket.on(REALTIME_EVENTS.noticeNew, (raw: unknown) => {
      if (noticeNewEventSchema.safeParse(raw).success)
        void queryClient.invalidateQueries({ queryKey: ['supervision'] });
    });
    socket.on(REALTIME_EVENTS.incidentNew, (raw: unknown) => {
      const event = incidentNewEventSchema.safeParse(raw);
      if (!event.success) return;
      const rows = queryClient.getQueryData<ShiftRow[]>(['supervision', 'turnos']);
      let site = rows?.find((row) => row.site.id === event.data.siteId)?.site.name;
      if (!site) {
        const details = queryClient.getQueriesData<ShiftDetail>({
          queryKey: ['supervision', 'detalle'],
        });
        const match = details.find(([, data]) => data?.site.id === event.data.siteId);
        site = match?.[1]?.site.name;
      }
      const message = `Incidente nuevo en ${site ?? 'un predio'}`;
      setIncident(message);
      setAnnouncement(message);
    });
    socket.connect();
    return () => {
      socket.disconnect();
      socket.removeAllListeners();
    };
  }, [enabled, queryClient]);
  return {
    connected,
    incident,
    announcement,
    dismissIncident: () => {
      setIncident('');
    },
  };
}

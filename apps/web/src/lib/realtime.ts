import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  NOTICE_KINDS,
  SOCKET_NAMESPACE,
  incidentNewEventSchema,
  noticeNewEventSchema,
  noticeUpdatedEventSchema,
  recordNewEventSchema,
  shiftUpdatedEventSchema,
} from '@garita/shared';
import { noticeLabels } from '@/features/avisos/labels';
import { z } from 'zod';
import type { noticesListResponseSchema } from '@garita/shared';
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
        void queryClient.invalidateQueries({ queryKey: ['avisos'] });
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
      const event = noticeNewEventSchema.safeParse(raw);
      if (!event.success) return;
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      void queryClient.invalidateQueries({ queryKey: ['avisos'] });
      const sites = queryClient.getQueryData<{ id: string; name: string }[]>(['sites']);
      const rows = queryClient.getQueryData<ShiftRow[]>(['supervision', 'turnos']);
      const details = queryClient.getQueriesData<ShiftDetail>({
        queryKey: ['supervision', 'detalle'],
      });
      const notices = queryClient.getQueriesData<z.infer<typeof noticesListResponseSchema>>({
        queryKey: ['avisos'],
      });
      const site =
        sites?.find((item) => item.id === event.data.siteId)?.name ??
        rows?.find((row) => row.site.id === event.data.siteId)?.site.name ??
        details.find(([, data]) => data?.site.id === event.data.siteId)?.[1]?.site.name ??
        notices
          .flatMap(([, data]) => data?.items ?? [])
          .find((item) => item.siteId === event.data.siteId)?.site.name;
      const kind = z.enum(NOTICE_KINDS).safeParse(event.data.kind);
      const label = kind.success ? noticeLabels[kind.data].toLocaleLowerCase('es-AR') : 'aviso';
      const message = `Aviso nuevo: ${label} en ${site ?? 'un predio'}`;
      setAnnouncement((previous) => (previous === message ? `${message}\u200B` : message));
    });
    socket.on(REALTIME_EVENTS.noticeUpdated, (raw: unknown) => {
      if (!noticeUpdatedEventSchema.safeParse(raw).success) return;
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      void queryClient.invalidateQueries({ queryKey: ['avisos'] });
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

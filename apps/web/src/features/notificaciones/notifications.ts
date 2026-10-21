import { z } from 'zod';
import { deviceSchema, registerDeviceRequestSchema } from '@garita/shared';
import { env } from '@/config/env';
import { apiDelete, apiPost } from '@/lib/api-client';
import { auth } from '@/lib/firebase';

const deletedSchema = z.object({ ok: z.literal(true) });
const DEVICE_ID_KEY = 'garita-notification-device-id';

export const notificationSetupHelp =
  'No vas a recibir avisos fuera del panel mientras el permiso esté rechazado. Android: permití las notificaciones del sitio en la configuración del navegador. iPhone: en iOS 16.4 o posterior, agregá el panel a Inicio y habilitá Notificaciones en Ajustes. Computadora: permití las notificaciones del sitio desde el ícono junto a la dirección.';

export function isAppleMobile(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isInstalledPwa(): boolean {
  const standalone = navigator as Navigator & { standalone?: boolean };
  return standalone.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export async function activateNotifications(): Promise<string> {
  if (!env.VITE_FIREBASE_MESSAGING_SENDER_ID || !env.VITE_FIREBASE_VAPID_KEY)
    throw new Error('Notificaciones no configuradas');
  if (isAppleMobile() && !isInstalledPwa())
    throw new Error(
      'Primero agregá el panel a la pantalla de inicio (iOS 16.4 o posterior): tocá Compartir y elegí “Agregar a pantalla de inicio”.',
    );
  if (!('Notification' in window)) throw new Error('Este navegador no admite notificaciones web');
  if (Notification.permission === 'denied') throw new Error(notificationSetupHelp);
  if (!('serviceWorker' in navigator))
    throw new Error('Este navegador no admite notificaciones web');
  const permissionRequest = Notification.requestPermission();
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) throw new Error('Este navegador no admite notificaciones web');
  const permission = await permissionRequest;
  if (permission !== 'granted') throw new Error(notificationSetupHelp);
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/firebase-messaging-scope/',
  });
  const token = await getToken(getMessaging(auth.app), {
    vapidKey: env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  const platform = /Android/i.test(navigator.userAgent)
    ? 'android'
    : isAppleMobile()
      ? 'ios'
      : 'web';
  const device = await apiPost(
    '/dispositivos',
    { token, kind: 'web', platform },
    registerDeviceRequestSchema,
    deviceSchema,
  );
  try {
    localStorage.setItem(DEVICE_ID_KEY, device.id);
  } catch {
    // El backend aún controla la vida útil si el almacenamiento local está bloqueado.
  }
  return 'Notificaciones activadas en este dispositivo';
}

export async function unregisterCurrentDevice(): Promise<void> {
  let id: string | null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return;
  }
  if (!id) return;
  try {
    await apiDelete(`/dispositivos/${encodeURIComponent(id)}`, deletedSchema);
  } finally {
    localStorage.removeItem(DEVICE_ID_KEY);
    if (env.VITE_FIREBASE_MESSAGING_SENDER_ID && env.VITE_FIREBASE_VAPID_KEY) {
      try {
        const { deleteToken, getMessaging, isSupported } = await import('firebase/messaging');
        if (await isSupported()) await deleteToken(getMessaging(auth.app));
      } catch {
        // El dispositivo ya se eliminó de la API; un token local fallido quedará inválido en FCM.
      }
    }
  }
}

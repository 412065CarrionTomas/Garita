import { fireEvent, render, screen } from '@testing-library/react';
import { env } from '@/config/env';
import { NotificationControl } from './notification-control';

const originalUserAgent = navigator.userAgent;

beforeEach(() => {
  env.VITE_FIREBASE_MESSAGING_SENDER_ID = '';
  env.VITE_FIREBASE_VAPID_KEY = '';
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
  window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
});

it('indica cuando falta la configuración pública de FCM', async () => {
  render(<NotificationControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Notificaciones no configuradas');
});

it('explica cómo instalar el panel en iPhone antes de pedir permiso', async () => {
  env.VITE_FIREBASE_MESSAGING_SENDER_ID = 'sender';
  env.VITE_FIREBASE_VAPID_KEY = 'vapid';
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
  render(<NotificationControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Primero agregá el panel a la pantalla de inicio',
  );
});

it('muestra instrucciones cuando los permisos ya fueron rechazados', async () => {
  env.VITE_FIREBASE_MESSAGING_SENDER_ID = 'sender';
  env.VITE_FIREBASE_VAPID_KEY = 'vapid';
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'denied' },
  });
  render(<NotificationControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Android: permití las notificaciones');
  expect(status).toHaveTextContent('iPhone: en iOS 16.4 o posterior');
  expect(status).toHaveTextContent('Computadora: permití las notificaciones');
});

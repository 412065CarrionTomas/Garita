import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { notificationKindSchema } from '@garita/shared';
import { z } from 'zod';
import { useAuth } from '@/features/auth/auth-context';

const dataSchema = z.object({
  kind: notificationKindSchema,
  shiftId: z.string().min(1).optional(),
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function NotificationNavigation() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user?.role !== 'guard') return;
    const open = (response: Notifications.NotificationResponse) => {
      const parsed = dataSchema.safeParse(response.notification.request.content.data);
      if (!parsed.success || !parsed.data.kind.startsWith('shift_')) return;
      const { kind, shiftId } = parsed.data;
      if (
        shiftId &&
        !['shift_removed', 'shift_cancelled', 'shift_reassigned_from_you'].includes(kind)
      )
        router.push(`/turno/${encodeURIComponent(shiftId)}`);
      else router.push('/(guard)');
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        open(response);
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => subscription.remove();
  }, [router, user?.role]);
  return null;
}

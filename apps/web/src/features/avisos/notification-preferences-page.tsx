import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { notificationPreferencesSchema, type NotificationPreferences } from '@garita/shared';
import { apiGet, apiPut } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function NotificationPreferencesPage() {
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiGet('/mis-preferencias/notificaciones', notificationPreferencesSchema),
  });
  const save = useMutation({
    mutationFn: (input: NotificationPreferences) =>
      apiPut(
        '/mis-preferencias/notificaciones',
        input,
        notificationPreferencesSchema,
        notificationPreferencesSchema,
      ),
    onSuccess: (data) => client.setQueryData(['notification-preferences'], data),
  });
  return (
    <section aria-labelledby="preferences-title" className="space-y-6">
      <Button asChild variant="outline">
        <Link to="/avisos">Volver a avisos</Link>
      </Button>
      <PageHeader
        id="preferences-title"
        title="Preferencias de notificación"
        description="Elegí las notificaciones push que querés recibir. Los avisos siempre aparecen en el panel."
      />
      {preferences.isPending ? (
        <p role="status">Cargando preferencias…</p>
      ) : preferences.isError ? (
        <Alert role="alert">
          No pudimos cargar tus preferencias.{' '}
          <Button variant="outline" onClick={() => void preferences.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="notify-not-started"
                checked={preferences.data.shift_not_started}
                disabled={save.isPending}
                onCheckedChange={(checked) => {
                  save.mutate({ shift_not_started: checked });
                }}
              />
              <Label htmlFor="notify-not-started">Notificarme los turnos no iniciados</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Los demás avisos no se pueden silenciar porque el predio queda sin vigilancia.
            </p>
            {save.isSuccess && <p role="status">Preferencia guardada.</p>}
            {save.isError && (
              <Alert role="alert">
                No pudimos guardar la preferencia. Volvé a intentar con el interruptor.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

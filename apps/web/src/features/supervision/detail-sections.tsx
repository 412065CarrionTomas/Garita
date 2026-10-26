import { useEffect } from 'react';
import { APIProvider, Map as GoogleMap, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { haversineMeters } from '@garita/shared';
import { env } from '@/config/env';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import type { Severity, ShiftDetail } from './contracts';
import { time, windowLabels } from './contracts';

export function WindowsSection({ detail }: { detail: ShiftDetail }) {
  const names = new Map(detail.rounds.map((round) => [round.id, round.name]));
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Rondas y ventanas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail.windows.length === 0 ? (
          <p>No hay ventanas para este turno.</p>
        ) : (
          detail.windows.map((window) => (
            <div key={window.id} className="border-b border-border pb-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {names.get(window.roundId) ?? 'Ronda'} · ventana {window.windowIndex + 1}
                </p>
                <StatusBadge
                  tone={
                    window.status === 'complete'
                      ? 'success'
                      : window.status === 'not_done'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {windowLabels[window.status]}
                </StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {time(window.startsAt)}–{time(window.endsAt)} · {window.recordedCount} de{' '}
                {window.expectedCount} puntos registrados
              </p>
              {window.severityLevel && <p className="text-sm">Gravedad: {window.severityLevel}</p>}
            </div>
          ))
        )}
        <h3 className="font-semibold">Puntos</h3>
        <ul className="space-y-2">
          {detail.points.map((point) => (
            <li key={point.id} className="flex justify-between gap-2">
              <span>{point.name}</span>
              <StatusBadge tone={point.registered ? 'success' : 'warning'}>
                {point.registered ? 'Registrado' : 'Pendiente'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RouteLine({ route }: { route: ShiftDetail['route'] }) {
  const map = useMap();
  const maps = useMapsLibrary('maps');
  useEffect(() => {
    if (!map || !maps || route.length < 2) return;
    const line = new maps.Polyline({
      map,
      path: route.map((point) => ({ lat: point.latitude, lng: point.longitude })),
    });
    return () => {
      line.setMap(null);
    };
  }, [map, maps, route]);
  return null;
}

export function RouteSection({ detail }: { detail: ShiftDetail }) {
  const points = new Map(detail.points.map((point) => [point.id, point]));
  const first = detail.route[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Recorrido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {env.VITE_GOOGLE_MAPS_API_KEY && first && (
          <div
            className="h-72 overflow-hidden rounded-xl border border-border"
            role="img"
            aria-label="Mapa del recorrido registrado"
          >
            <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
              <GoogleMap
                defaultCenter={{ lat: first.latitude, lng: first.longitude }}
                defaultZoom={14}
                mapId="GARITA_SHIFT_ROUTE"
                className="h-72 w-full"
              >
                <RouteLine route={detail.route} />
              </GoogleMap>
            </APIProvider>
          </div>
        )}
        <ol className="list-inside list-decimal space-y-2" aria-label="Puntos del recorrido">
          {detail.route.map((item, index) => {
            const point = points.get(item.checkpointId);
            return (
              <li key={`${item.checkpointId}-${index}`} className="text-sm">
                {point?.name ?? 'Punto'} · {time(item.occurredAtDevice)} ·{' '}
                {point
                  ? `${Math.round(haversineMeters(item.latitude, item.longitude, point.latitude, point.longitude))} m del punto configurado`
                  : 'Distancia no disponible'}
              </li>
            );
          })}
        </ol>
        {detail.route.length === 0 && <p>No hay puntos registrados en el recorrido.</p>}
      </CardContent>
    </Card>
  );
}

export function RecordsSection({
  detail,
  flaggedOnly,
  severity,
  onFlaggedOnly,
  onSeverity,
}: {
  detail: ShiftDetail;
  flaggedOnly: boolean;
  severity: '' | Severity;
  onFlaggedOnly: (value: boolean) => void;
  onSeverity: (value: '' | Severity) => void;
}) {
  const points = new Map(detail.points.map((point) => [point.id, point.name]));
  const records = detail.records.filter(
    (record) =>
      (!flaggedOnly || record.flags.length > 0) &&
      (!severity || record.flags.some((flag) => flag.severity === severity)),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Registros
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={flaggedOnly}
              onCheckedChange={(checked) => {
                onFlaggedOnly(checked === true);
              }}
            />
            Solo marcados
          </Label>
          <div className="space-y-2">
            <Label htmlFor="severity-filter">Gravedad</Label>
            <NativeSelect
              id="severity-filter"
              value={severity}
              onChange={(event) => {
                onSeverity(event.target.value as '' | Severity);
              }}
            >
              <NativeSelectOption value="">Todas</NativeSelectOption>
              <NativeSelectOption value="grave">Grave</NativeSelectOption>
              <NativeSelectOption value="media">Media</NativeSelectOption>
              <NativeSelectOption value="leve">Leve</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <ul className="space-y-3">
          {records.map((record) => (
            <li key={record.id} className="border-b border-border pb-2 last:border-0">
              <p className="font-medium">
                {points.get(record.checkpointId) ?? 'Punto'} · {time(record.occurredAtDevice)}
              </p>
              {record.flags.length ? (
                <ul>
                  {record.flags
                    .filter((flag) => !severity || flag.severity === severity)
                    .map((flag) => (
                      <li key={flag.id} className="text-sm">
                        {flag.severity}: {flag.reason}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin marcas</p>
              )}
            </li>
          ))}
        </ul>
        {records.length === 0 && <p>No hay registros para este filtro.</p>}
        {detail.phoneWithoutNfc && <p>Celular sin NFC</p>}
      </CardContent>
    </Card>
  );
}

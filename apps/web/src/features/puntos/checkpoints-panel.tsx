import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps';
import { useQuery } from '@tanstack/react-query';
import { checkpointInputSchema, checkpointsResponseSchema } from '@garita/shared';
import { useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { apiDownload, apiGet, apiPatch, apiPost, ApiError } from '@/lib/api-client';
import { env } from '@/config/env';
import { useAuth } from '../auth/auth-context';
import { SiteLocation } from '../mapa/site-location';

const idResponse = z.looseObject({ id: z.string() });
const emptyInput = z.object({});

interface SiteProps {
  site: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    status: 'active' | 'inactive';
  };
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) return;
  const body = error.body as Record<string, unknown>;
  return typeof body.code === 'string' ? body.code : undefined;
}

function roundNames(error: unknown): string[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null)
    return [];
  const rounds: unknown = (error.body as Record<string, unknown>).rounds;
  if (!Array.isArray(rounds)) return [];
  const names: string[] = [];
  for (const round of rounds as unknown[]) {
    if (
      typeof round === 'object' &&
      round !== null &&
      'name' in round &&
      typeof round.name === 'string'
    )
      names.push(round.name);
  }
  return names;
}

export function CheckpointsPanel({ site }: SiteProps) {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const points = useQuery({
    queryKey: ['puntos', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/puntos`, checkpointsResponseSchema),
  });
  const [form, setForm] = useState({
    name: '',
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    toleranceRadiusMeters: 30,
    stickerLocation: '',
    isIndoor: false,
  });
  const [editingId, setEditingId] = useState<string>();
  const [confirmFar, setConfirmFar] = useState(false);
  const [pendingAction, setPendingAction] = useState<() => Promise<unknown>>();
  const [message, setMessage] = useState('');

  const input = (confirmFarLocation = false) => ({
    ...form,
    stickerLocation: form.stickerLocation || undefined,
    confirmFarLocation,
  });

  const save = async (event?: SyntheticEvent<HTMLFormElement>, confirmed = false) => {
    event?.preventDefault();
    const parsed = checkpointInputSchema.safeParse(input(confirmed));
    if (!parsed.success) {
      setMessage('Revisá el nombre, la ubicación y el radio de tolerancia (entre 10 y 200 m).');
      return;
    }
    try {
      if (editingId)
        await apiPatch(`/puntos/${editingId}`, parsed.data, checkpointInputSchema, idResponse);
      else
        await apiPost(`/predios/${site.id}/puntos`, parsed.data, checkpointInputSchema, idResponse);
      setConfirmFar(false);
      setEditingId(undefined);
      setMessage('Punto guardado.');
      await points.refetch();
    } catch (error) {
      if (errorCode(error) === 'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION') {
        setConfirmFar(true);
        return;
      }
      setMessage('No se pudo guardar el punto. Verificá si ya existe otro con ese nombre.');
    }
  };

  const download = async (checkpointId?: string) => {
    const query = checkpointId ? `?puntos=${encodeURIComponent(checkpointId)}` : '';
    let blob: Blob;
    try {
      blob = await apiDownload(`/predios/${site.id}/stickers${query}`);
    } catch {
      setMessage('No se pudo descargar el sticker. Intentá de nuevo.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'stickers-puntos.pdf';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const edit = (point: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    toleranceRadiusMeters: number;
    stickerLocation: string | null;
    isIndoor: boolean;
  }) => {
    setEditingId(point.id);
    setForm({
      name: point.name,
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      toleranceRadiusMeters: point.toleranceRadiusMeters,
      stickerLocation: point.stickerLocation ?? '',
      isIndoor: point.isIndoor,
    });
  };

  const confirm = async () => {
    if (!pendingAction) return;
    await pendingAction();
    setPendingAction(undefined);
    await points.refetch();
  };

  return (
    <section aria-labelledby={`points-${site.id}`} className="mt-4 space-y-4 rounded border p-4">
      <h3 id={`points-${site.id}`} className="text-lg font-semibold">
        Puntos de control
      </h3>
      {admin && site.status === 'active' && (
        <form className="grid gap-3" onSubmit={(event) => void save(event)}>
          <label>
            Nombre del punto
            <input
              required
              maxLength={200}
              value={form.name}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          <SiteLocation
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(latitude, longitude) => {
              setForm({ ...form, latitude, longitude });
            }}
          />
          <label>
            Radio de tolerancia (m)
            <input
              aria-label="Radio de tolerancia (m)"
              type="number"
              min={10}
              max={200}
              step={1}
              required
              value={form.toleranceRadiusMeters}
              onChange={(event) => {
                setForm({ ...form, toleranceRadiusMeters: Number(event.target.value) });
              }}
              className="block rounded border p-2"
            />
          </label>
          <label>
            Ubicación del sticker (opcional)
            <textarea
              value={form.stickerLocation}
              onChange={(event) => {
                setForm({ ...form, stickerLocation: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={form.isIndoor}
              onChange={(event) => {
                setForm({ ...form, isIndoor: event.target.checked });
              }}
            />
            Punto interior
          </label>
          <div className="flex gap-3">
            <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
              {editingId ? 'Guardar cambios' : 'Crear punto'}
            </button>
            {editingId && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setEditingId(undefined);
                  setForm({ ...form, name: '' });
                }}
              >
                Cancelar edición
              </button>
            )}
          </div>
        </form>
      )}
      {admin && (
        <button className="rounded border px-3 py-2" onClick={() => void download()}>
          Descargar stickers de todos
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {points.isPending ? (
        <p role="status">Cargando puntos…</p>
      ) : points.isError ? (
        <p role="alert">No se pudieron cargar los puntos.</p>
      ) : (
        <>
          {points.data.length > 0 && env.VITE_GOOGLE_MAPS_API_KEY && (
            <div aria-label={`Mapa de puntos de ${site.name}`}>
              <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
                <Map
                  defaultCenter={{ lat: Number(site.latitude), lng: Number(site.longitude) }}
                  defaultZoom={15}
                  mapId="GARITA_CHECKPOINTS"
                  className="h-72 w-full"
                >
                  <AdvancedMarker
                    position={{ lat: Number(site.latitude), lng: Number(site.longitude) }}
                    title={site.name}
                  />
                  {points.data.map((point) => (
                    <AdvancedMarker
                      key={point.id}
                      position={{ lat: Number(point.latitude), lng: Number(point.longitude) }}
                      title={`${point.name}${point.isIndoor ? ' · Interior' : ''}`}
                    />
                  ))}
                </Map>
              </APIProvider>
            </div>
          )}
          <ul className="divide-y">
            {points.data.map((point) => (
              <li key={point.id} className="space-y-2 py-3">
                <div className="font-medium">
                  {point.name}
                  {point.isIndoor ? ' · Interior' : ''}
                </div>
                {point.stickerLocation && <p>{point.stickerLocation}</p>}
                <p className="text-sm">
                  Radio: {point.toleranceRadiusMeters} m · {point.latitude}, {point.longitude}
                </p>
                {admin && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="underline"
                      onClick={() => {
                        edit(point);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="underline"
                      onClick={() => {
                        if (
                          window.confirm('El QR impreso dejará de ser válido. ¿Querés regenerarlo?')
                        )
                          void apiPost(
                            `/puntos/${point.id}/regenerar-qr`,
                            {},
                            emptyInput,
                            z.looseObject({ checkpoint: idResponse, qrPayload: z.string() }),
                          )
                            .then(() => {
                              setMessage('QR regenerado. Imprimí un sticker nuevo.');
                            })
                            .catch(() => {
                              setMessage('No se pudo regenerar el QR. Intentá de nuevo.');
                            });
                      }}
                    >
                      Regenerar QR
                    </button>
                    <button
                      className="underline"
                      onClick={() => {
                        setPendingAction(() => async () => {
                          try {
                            await apiPost(`/puntos/${point.id}/baja`, {}, emptyInput, idResponse);
                          } catch (error) {
                            if (error instanceof ApiError && error.status === 409) {
                              const names = roundNames(error);
                              setMessage(
                                names.length
                                  ? `No se puede dar de baja: está incluida en ${names.join(', ')}.`
                                  : 'No se puede dar de baja: está incluida en rondas activas.',
                              );
                              return;
                            }
                            setMessage('No se pudo dar de baja el punto. Intentá de nuevo.');
                          }
                        });
                      }}
                    >
                      Dar de baja
                    </button>
                    <button className="underline" onClick={() => void download(point.id)}>
                      Descargar sticker
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {confirmFar && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`far-${site.id}`}
          className="rounded border p-4"
        >
          <h4 id={`far-${site.id}`} className="font-semibold">
            El punto está a más de 1 km del predio
          </h4>
          <p>Confirmá que la ubicación sea correcta para guardar el punto.</p>
          <button
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
            onClick={() => void save(undefined, true)}
          >
            Confirmar ubicación
          </button>
          <button
            className="ml-3 underline"
            onClick={() => {
              setConfirmFar(false);
            }}
          >
            Cancelar
          </button>
        </div>
      )}
      {pendingAction && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar baja"
          className="rounded border p-4"
        >
          <p>¿Dar de baja este punto de control?</p>
          <button
            onClick={() => void confirm()}
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
          >
            Confirmar baja
          </button>
          <button
            className="ml-3 underline"
            onClick={() => {
              setPendingAction(undefined);
            }}
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}

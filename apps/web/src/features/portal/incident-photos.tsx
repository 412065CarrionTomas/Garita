import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { portalPhotosSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';

export function IncidentPhotos({ id, count }: { id: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const photos = useQuery({
    queryKey: ['portal', 'photos', id],
    queryFn: () => apiGet(`/portal/incidentes/${encodeURIComponent(id)}/fotos`, portalPhotosSchema),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    // Los enlaces vencen a los cinco minutos; renovar antes de que caduquen mientras se ven.
    refetchInterval: open ? 240000 : false,
  });
  if (count === 0) return <p>Sin fotos</p>;
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setSelected(null);
        }}
      >
        {open ? 'Ocultar fotos' : `Ver fotos (${count})`}
      </Button>
      {open && photos.isPending && <p role="status">Cargando fotos…</p>}
      {open && photos.error && (
        <Alert role="alert">
          No se pudieron cargar las fotos.{' '}
          <Button variant="outline" onClick={() => void photos.refetch()}>
            Reintentar fotos
          </Button>
        </Alert>
      )}
      {open && photos.data && (
        <div className="flex flex-wrap gap-3">
          {photos.data.map((photo, index) => (
            <Button
              key={index}
              variant="outline"
              className="h-auto max-w-full"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(String(index));
              }}
              aria-label={`Ampliar foto ${index + 1}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={`Foto ${index + 1} del incidente`}
                className="max-w-full"
              />
            </Button>
          ))}
        </div>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogTitle>Foto del incidente</DialogTitle>
          <DialogDescription>Evidencia compartida por tu empresa de seguridad.</DialogDescription>
          {selected !== null && photos.data?.[Number(selected)] && (
            <img
              src={photos.data[Number(selected)]?.fullUrl}
              alt="Foto ampliada del incidente"
              className="max-w-full"
            />
          )}
          <DialogClose asChild>
            <Button variant="outline">Cerrar foto</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}

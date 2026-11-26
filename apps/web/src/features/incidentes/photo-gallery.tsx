import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface Photo {
  id: string;
  thumbnailUrl: string;
  fullUrl: string;
}

/** Miniaturas que abren la foto completa; en el visor ←/→ recorren las fotos. */
export function PhotoGallery({ photos, caption }: { photos: Photo[]; caption: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length)
    return <p className="text-muted-foreground">El vigilador no adjuntó fotos.</p>;
  const current = open === null ? null : photos[open];
  const step = (delta: number) => {
    setOpen((index) => (index === null ? null : (index + delta + photos.length) % photos.length));
  };
  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(--spacing(36),1fr))] gap-3">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              className="block w-full"
              onClick={() => {
                setOpen(index);
              }}
              aria-label={`Ampliar foto ${String(index + 1)} de ${String(photos.length)}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={`Foto ${String(index + 1)}: ${caption}`}
                className="aspect-square w-full rounded-md border-[1.5px] border-input bg-muted object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      {current && open !== null && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setOpen(null);
          }}
        >
          <DialogContent
            className="sm:max-w-4xl"
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') step(1);
              if (event.key === 'ArrowLeft') step(-1);
            }}
          >
            <DialogTitle>
              Foto {open + 1} de {photos.length}
            </DialogTitle>
            <DialogDescription>{caption}</DialogDescription>
            <img
              src={current.fullUrl}
              alt={`Foto ${String(open + 1)}: ${caption}`}
              className="max-h-[70vh] w-full object-contain"
            />
            {photos.length > 1 && (
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    step(-1);
                  }}
                >
                  <ChevronLeft aria-hidden="true" /> Anterior
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    step(1);
                  }}
                >
                  Siguiente <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Enlace interno al que lleva un clic, o null si el clic no es una navegación interna normal. */
function internalTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const to = `${url.pathname}${url.search}${url.hash}`;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return to === here ? null : to;
}

/**
 * Pide confirmación antes de dejar la pantalla con cambios sin guardar: al cerrar o recargar la
 * pestaña (diálogo del navegador) y al tocar un enlace interno (diálogo propio). Funciona con
 * BrowserRouter: escucha los clics en fase de captura y frena el enlace antes de que el router
 * navegue. No intercepta el botón Atrás del navegador (eso requiere un router de datos).
 */
export function useLeaveGuard(active: boolean): ReactElement {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const to = internalTarget(event);
      if (!to) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(to);
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return (
    <AlertDialog
      open={active && pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent className="space-y-4">
        <AlertDialogTitle className="font-cond text-xl font-semibold tracking-wider uppercase">
          ¿Salir sin guardar?
        </AlertDialogTitle>
        <AlertDialogDescription>
          Tenés cambios en el diseño que todavía no guardaste. Si salís, se pierden.
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Seguir editando</Button>
          </AlertDialogCancel>
          <AlertDialogAction
            asChild
            onClick={() => {
              const to = pending;
              setPending(null);
              if (to) void navigate(to);
            }}
          >
            <Button>Salir sin guardar</Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

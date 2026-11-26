import { SUSPENSION_MESSAGES } from '@garita/shared';
import { Banner } from '@/ui';
import { cachedNotice, type LoadError } from '@/lib/cached-get';

/**
 * Aviso de carga de una pantalla del vigilador. La suspensión de la cuenta va primero (aunque haya
 * copia local); después, si falló y hay copia, de cuándo es lo que se ve; si no, el error.
 */
export function LoadBanner({
  error,
  savedAt,
  what,
}: {
  error: LoadError;
  savedAt: string | null;
  what: string;
}) {
  if (error === 'suspended') return <Banner tone="danger">{SUSPENSION_MESSAGES.guard}</Banner>;
  if (!error) return null;
  if (savedAt) return <Banner tone="warning">{cachedNotice(savedAt)}</Banner>;
  return (
    <Banner tone="danger">{`No se pudieron cargar ${what}. Deslizá hacia abajo para reintentar.`}</Banner>
  );
}

import { liveHealthResponseSchema } from '@garita/shared';
import { useEffect, useState } from 'react';

import { apiGet } from '@/lib/api-client';

export type ApiHealthStatus = 'pending' | 'success' | 'error';

/** Consulta una vez la disponibilidad de la API al montar el componente. */
export function useApiHealth(): ApiHealthStatus {
  const [status, setStatus] = useState<ApiHealthStatus>('pending');

  useEffect(() => {
    const controller = new AbortController();

    apiGet('/health/live', liveHealthResponseSchema, { signal: controller.signal })
      .then(() => {
        setStatus('success');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus('error');
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  return status;
}

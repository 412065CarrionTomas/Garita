import { liveHealthResponseSchema } from '@garita/shared';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';

export function useApiHealth() {
  return useQuery({
    queryKey: ['health', 'live'],
    queryFn: ({ signal }) => apiGet('/health/live', liveHealthResponseSchema, { signal }),
    refetchInterval: 60_000,
  });
}

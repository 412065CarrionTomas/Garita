import { useQuery } from '@tanstack/react-query';
import { accountStateResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';

export function useAccountState(enabled: boolean) {
  return useQuery({
    queryKey: ['cuenta', 'estado'],
    enabled,
    queryFn: () => apiGet('/cuenta/estado', accountStateResponseSchema),
    refetchInterval: 60_000,
  });
}

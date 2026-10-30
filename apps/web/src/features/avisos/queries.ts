import { useQuery } from '@tanstack/react-query';
import { noticesListResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';

export function useOpenNotices(enabled: boolean) {
  return useQuery({
    queryKey: ['avisos', 'open'],
    queryFn: () => apiGet('/avisos?estado=open', noticesListResponseSchema),
    enabled,
    refetchInterval: 30_000,
  });
}

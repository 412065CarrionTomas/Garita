import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authMeResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '../../auth/auth-context';

export function useAccountSuspension() {
  const { user } = useAuth();
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['account-suspension', user?.id],
    queryFn: async () =>
      (await apiGet('/auth/me', authMeResponseSchema)).company.accountStatus ?? 'active',
    enabled: Boolean(user),
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => (query.state.data === 'suspended' ? 15_000 : false),
  });
  useEffect(() => {
    const suspended = () => {
      client.setQueryData(['account-suspension', user?.id], 'suspended');
    };
    window.addEventListener('garita:account-suspended', suspended);
    return () => {
      window.removeEventListener('garita:account-suspended', suspended);
    };
  }, [client, user?.id]);
  useEffect(() => {
    if (state.data && state.data !== 'suspended')
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'account-suspension',
      });
  }, [client, state.data]);
  return state.data === 'suspended';
}

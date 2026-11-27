import { usersPageSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';

export async function loadAvailableGuards() {
  const guards = new Map<string, ReturnType<typeof usersPageSchema.parse>['items'][number]>();
  for (const status of ['active', 'invitation_pending']) {
    let page = 1;
    let pages: number;
    do {
      const result = await apiGet(
        `/usuarios?rol=guard&estado=${status}&porPagina=50&pagina=${page}`,
        usersPageSchema,
      );
      for (const guard of result.items) guards.set(guard.id, guard);
      pages = result.paginas;
      page++;
    } while (page <= pages);
  }
  return { items: [...guards.values()] };
}

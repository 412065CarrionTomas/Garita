import { useEffect, useId } from 'react';
import { PAGE_SIZES } from '@garita/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pageNumbers } from '@/lib/page-numbers';

/** Paginación de listados paginados en el backend, con elección de tamaño de página. */
export function Pagination({
  page,
  pages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Al cambiar el tamaño, quien lo usa vuelve a la página 1. */
  onPageSizeChange: (size: number) => void;
}) {
  const sizeId = useId();
  // Si la página quedó fuera de rango (p. ej. se dio de baja el único ítem de la última), vuelve a la última.
  useEffect(() => {
    if (pages > 0 && page > pages) onPageChange(pages);
  }, [page, pages, onPageChange]);
  // El rango sale de la página pedida, no de las filas en pantalla: mientras carga la página
  // nueva se siguen viendo las de la anterior.
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm tabular-nums sm:grid-cols-[1fr_auto_1fr]">
      <span className="text-muted-foreground">
        {total === 0
          ? 'Sin resultados'
          : first > total
            ? `${String(total)} en total`
            : `${String(first)}–${String(last)} de ${String(total)}`}
      </span>
      <nav
        aria-label="Paginación"
        className="col-span-2 row-start-2 flex items-center justify-center gap-1 sm:col-span-1 sm:row-start-auto"
      >
        {pageNumbers(page, pages).map((number, index) =>
          number === null ? (
            <span
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={number}
              type="button"
              size="sm"
              variant={number === page ? 'default' : 'ghost'}
              aria-label={`Página ${String(number)}`}
              aria-current={number === page ? 'page' : undefined}
              onClick={() => {
                if (number !== page) onPageChange(number);
              }}
            >
              {number}
            </Button>
          ),
        )}
      </nav>
      <div className="flex items-center justify-end gap-2">
        <Label htmlFor={sizeId}>Por página</Label>
        <NativeSelect
          id={sizeId}
          value={String(pageSize)}
          onChange={(event) => {
            onPageSizeChange(Number(event.target.value));
          }}
        >
          {PAGE_SIZES.map((size) => (
            <NativeSelectOption key={size} value={String(size)}>
              {size}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

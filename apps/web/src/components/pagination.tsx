import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PAGE_SIZES, pageItems } from '@/lib/page-items';

/** Pie de una lista paginada: cuántos se ven, las páginas (centradas) y cuántos por página. */
export function Pagination({
  page,
  pageSize,
  total,
  shown,
  label,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Cuántos trae la página actual. */
  shown: number;
  /** Qué se pagina, para lectores de pantalla (ej. "alertas"). */
  label: string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = first + shown - 1;
  return (
    <div className="grid items-center gap-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
      <p className="text-muted-foreground tabular-nums">
        {first === last ? String(first) : `${String(first)}–${String(last)}`} de {String(total)}
      </p>
      <nav aria-label={`Páginas de ${label}`} className="justify-self-center">
        <ul className="flex items-center gap-1">
          {pageItems(page, pages).map((item, index) =>
            item === 'gap' ? (
              <li
                key={`gap-${String(index)}`}
                aria-hidden="true"
                className="px-1 text-muted-foreground"
              >
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  aria-label={`Página ${String(item)}`}
                  aria-current={item === page ? 'page' : undefined}
                  onClick={() => {
                    if (item !== page) onPage(item);
                  }}
                  className={cn(
                    't-numeral h-9 min-w-9 rounded-md border-[1.5px] px-2 text-base transition-colors',
                    item === page
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-transparent text-foreground hover:border-input hover:bg-muted',
                  )}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ul>
      </nav>
      <div className="flex items-center gap-2 sm:justify-self-end">
        <Label htmlFor={`page-size-${label}`}>Por página</Label>
        <NativeSelect
          id={`page-size-${label}`}
          size="sm"
          value={pageSize}
          onChange={(event) => {
            onPageSize(Number(event.target.value));
          }}
        >
          {PAGE_SIZES.map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}

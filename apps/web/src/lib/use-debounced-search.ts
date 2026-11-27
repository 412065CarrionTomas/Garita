import { useEffect, useState } from 'react';

/**
 * Búsqueda que se aplica cuando se deja de tipear (300 ms) y vuelve a la página 1.
 * No hace nada si el término recortado no cambió (montaje, espacios al final).
 */
export function useDebouncedSearch(setPage: (page: number) => void) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const term = input.trim();
    if (term === search) return;
    const timer = setTimeout(() => {
      setSearch(term);
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [input, search, setPage]);
  return { input, setInput, search };
}

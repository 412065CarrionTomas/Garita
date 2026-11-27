/* eslint react-refresh/only-export-components: off */
import { useState, type ReactNode } from 'react';

export function Link({
  children,
  to,
  ...props
}: {
  children: ReactNode;
  to: string;
  [key: string]: unknown;
}) {
  return (
    <a href={to} {...props}>
      {children}
    </a>
  );
}
export function NavLink({
  children,
  to,
  className,
  ...props
}: {
  children: ReactNode;
  to: string;
  className?: string | ((state: { isActive: boolean }) => string);
  [key: string]: unknown;
}) {
  return (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive: false }) : className}
      {...props}
    >
      {children}
    </a>
  );
}
export function Navigate() {
  return null;
}
export function useNavigate() {
  return jest.fn();
}
export function useLocation(): { pathname: string } {
  return { pathname: window.location.pathname };
}
type SearchInit = URLSearchParams | Record<string, string>;
/** Lee y escribe la query de window.location; cada componente vuelve a pintarse con lo que cambia. */
export function useSearchParams(): [
  URLSearchParams,
  (next: SearchInit | ((old: URLSearchParams) => SearchInit), options?: unknown) => void,
] {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
  const update = (next: SearchInit | ((old: URLSearchParams) => SearchInit)) => {
    const value = new URLSearchParams(typeof next === 'function' ? next(params) : next);
    window.history.replaceState({}, '', `${window.location.pathname}?${value.toString()}`);
    setParams(value);
  };
  return [params, update];
}
export function Outlet() {
  return null;
}
export function Routes({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function Route({ element }: { element?: ReactNode }) {
  return <>{element}</>;
}
export function BrowserRouter({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function MemoryRouter({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

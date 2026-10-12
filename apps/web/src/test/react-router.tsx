/* eslint react-refresh/only-export-components: off */
import type { ReactNode } from 'react';

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
export function Navigate() {
  return null;
}
export function useNavigate() {
  return jest.fn();
}
export function useSearchParams(): [URLSearchParams] {
  return [new URLSearchParams(window.location.search)];
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

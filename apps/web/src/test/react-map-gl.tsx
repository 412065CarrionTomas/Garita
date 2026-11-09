/* eslint react-refresh/only-export-components: off */
import type { ReactNode } from 'react';

/** Reemplaza a react-map-gl/maplibre en los tests: jsdom no tiene WebGL (ver jest.config.js). */
export default function Map({ children }: { children?: ReactNode }) {
  return <div data-testid="map">{children}</div>;
}
export function Marker({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
export function Source({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function Layer() {
  return null;
}
export function useMap() {
  return { current: undefined };
}

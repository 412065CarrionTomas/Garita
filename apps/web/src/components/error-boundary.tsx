import { Component } from 'react';
import type { ReactNode } from 'react';

/**
 * Evita la pantalla en blanco ante una excepción de render. Con `fallback`, muestra eso en lugar
 * del aviso de página completa (p. ej. para aislar un bloque de una pantalla).
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div role="alert" className="p-6">
        <p>Ocurrió un error inesperado.</p>
        <button
          type="button"
          className="underline"
          onClick={() => {
            window.location.reload();
          }}
        >
          Recargar la página
        </button>
      </div>
    );
  }
}

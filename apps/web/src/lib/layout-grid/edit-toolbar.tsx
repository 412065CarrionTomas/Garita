import { useEffect, type ReactNode } from 'react';
import { Pencil, RotateCcw, Undo2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ViewLayoutEditor } from './use-view-layout-editor';

/**
 * Acciones del editor de bloques, para el lugar de acciones del encabezado de la pantalla. Fuera
 * de edición, solo "Editar diseño" (y solo si la pantalla es lo bastante ancha). En edición:
 * deshacer, restablecer, cancelar y guardar; cancelar con cambios pide confirmación.
 */
export function EditToolbar({
  editor,
  editable,
  children,
}: {
  editor: ViewLayoutEditor;
  /** La ventana permite editar (grilla completa). */
  editable: boolean;
  /** Acciones extra del modo edición (p. ej. el panel de bloques). */
  children?: ReactNode;
}) {
  const { editing, dirty, saving, dispatch } = editor;
  // Ctrl+Z (Cmd+Z) deshace mientras se edita, salvo que el foco esté en un campo de texto.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return;
      event.preventDefault();
      dispatch({ type: 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [editing, dispatch]);
  if (!editing)
    return editable && editor.items ? (
      <Button variant="outline" onClick={editor.start}>
        <Pencil aria-hidden="true" />
        Editar diseño
      </Button>
    ) : null;
  const cancel = () => {
    editor.dispatch({ type: 'cancel' });
  };
  return (
    <div
      role="toolbar"
      aria-label="Edición del diseño"
      className="flex flex-wrap items-center gap-2"
    >
      {children}
      <Button
        variant="outline"
        disabled={!editor.canUndo || saving}
        onClick={() => {
          editor.dispatch({ type: 'undo' });
        }}
      >
        <Undo2 aria-hidden="true" />
        Deshacer
      </Button>
      <Button
        variant="outline"
        disabled={saving}
        onClick={() => {
          editor.dispatch({ type: 'reset' });
        }}
      >
        <RotateCcw aria-hidden="true" />
        Restablecer diseño
      </Button>
      {dirty ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={saving}>
              Cancelar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="space-y-4">
            <AlertDialogTitle className="font-cond text-xl font-semibold tracking-wider uppercase">
              ¿Descartar los cambios?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El diseño vuelve a como estaba la última vez que lo guardaste.
            </AlertDialogDescription>
            <div className="flex flex-wrap justify-end gap-2">
              <AlertDialogCancel asChild>
                <Button variant="outline">Seguir editando</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild onClick={cancel}>
                <Button>Descartar cambios</Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button variant="outline" disabled={saving} onClick={cancel}>
          Cancelar
        </Button>
      )}
      <Button disabled={!dirty || saving} onClick={editor.save}>
        {saving ? 'Guardando…' : 'Guardar diseño'}
      </Button>
    </div>
  );
}

import { useId } from 'react';
import { LayoutPanelLeft } from 'lucide-react';
import type { LayoutItem } from '@garita/shared';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import type { ViewLayoutEditor } from './use-view-layout-editor';

export interface Choice {
  value: string;
  label: string;
}
/** Un ajuste de un bloque con valores cerrados (el catálogo define cuáles son válidos). */
export interface SettingField {
  key: string;
  label: string;
  options: readonly Choice[];
}
/** Cómo se presenta un bloque en el panel: textos visibles de sus presentaciones y ajustes. */
export interface BlockDescription {
  title: string;
  presentations: readonly Choice[];
  settings: readonly SettingField[];
}

function BlockFields({
  item,
  description,
  editor,
}: {
  item: LayoutItem;
  description: BlockDescription;
  editor: ViewLayoutEditor;
}) {
  const switchId = useId();
  const { dispatch } = editor;
  return (
    <fieldset className="space-y-3 border-b border-border px-5 py-4 last:border-b-0">
      <legend className="sr-only">{description.title}</legend>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={switchId}
          className="font-cond text-base font-semibold tracking-wider uppercase"
        >
          {description.title}
        </label>
        <span className="flex items-center gap-2 text-sm">
          <span aria-hidden="true">{item.hidden ? 'Oculto' : 'Visible'}</span>
          <Switch
            id={switchId}
            checked={!item.hidden}
            onCheckedChange={(checked) => {
              dispatch({ type: 'hidden', id: item.id, hidden: !checked });
            }}
          />
        </span>
      </div>
      {!item.hidden && description.presentations.length > 1 && (
        <div className="space-y-1.5">
          <p className="t-label text-muted-foreground">Presentación</p>
          <SegmentedFilter
            ariaLabel={`Presentación de ${description.title}`}
            options={[...description.presentations]}
            value={item.presentation}
            onChange={(presentation) => {
              dispatch({ type: 'presentation', id: item.id, presentation });
            }}
          />
        </div>
      )}
      {!item.hidden &&
        description.settings.map((field) => {
          const value = item.settings[field.key];
          return (
            <div key={field.key} className="space-y-1.5">
              <p className="t-label text-muted-foreground">{field.label}</p>
              <SegmentedFilter
                ariaLabel={`${field.label} de ${description.title}`}
                options={[...field.options]}
                value={typeof value === 'string' ? value : ''}
                onChange={(next) => {
                  dispatch({ type: 'settings', id: item.id, patch: { [field.key]: next } });
                }}
              />
            </div>
          );
        })}
    </fieldset>
  );
}

/**
 * Panel lateral del modo edición: mostrar u ocultar cada bloque, elegir su presentación y sus
 * ajustes. Los cambios van al borrador (se ven al instante, se deshacen y se guardan con el
 * resto del diseño), nunca directo a la API.
 */
export function BlocksPanel({
  editor,
  describe,
}: {
  editor: ViewLayoutEditor;
  describe: (id: string) => BlockDescription;
}) {
  const items = editor.items ?? [];
  const hidden = items.filter((item) => item.hidden).length;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" disabled={editor.saving}>
          <LayoutPanelLeft aria-hidden="true" />
          Bloques
          {hidden > 0 && (
            <span className="t-stamp border-[1.5px] border-dashed border-current px-1.5">
              {hidden} {hidden === 1 ? 'oculto' : 'ocultos'}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-cond text-xl font-semibold tracking-wider uppercase">
            Bloques del diseño
          </SheetTitle>
          <SheetDescription>
            Mostrá u ocultá cada bloque y elegí cómo se ve. Los cambios se aplican al tocar Guardar
            diseño.
          </SheetDescription>
        </SheetHeader>
        {Object.keys(editor.catalog.widgets).map((id) => {
          const item = items.find((entry) => entry.id === id);
          return item ? (
            <BlockFields key={id} item={item} description={describe(id)} editor={editor} />
          ) : null;
        })}
      </SheetContent>
    </Sheet>
  );
}

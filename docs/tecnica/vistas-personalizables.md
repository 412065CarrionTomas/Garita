# Vistas personalizables y favoritos

Algunas pantallas del panel se arman con **bloques** que cada usuario puede mover, redimensionar, ocultar y mostrar de otra forma. El primer uso es el **Resumen de la empresa** del administrador (`/resumen`). El diseño se guarda por usuario y por pantalla. Además, cada pantalla puede tener **favoritos**: entidades (predios, vigiladores, clientes) que el usuario fija arriba de sus listas con su propio orden.

Todo está pensado para reutilizarse en otras pantallas: el contrato vive en `@garita/shared`, la API no conoce los bloques más allá del catálogo, y la web separa un motor puro de los componentes.

## Reglas del producto

| Regla                        | Decisión                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diseño por defecto           | Cada pantalla define el suyo en su catálogo. En el Resumen es la propuesta A ("Foja de guardia").                                                                           |
| Guardado del diseño          | **Explícito.** Mover, redimensionar u ocultar cambia un borrador; solo **Guardar diseño** lo persiste. Cancelar con cambios pide confirmación.                              |
| Reacomodo                    | **Compactación vertical:** ningún bloque visible queda con hueco encima. Un bloque que se mueve pasa antes que otro cuando su borde superior supera la mitad de ese otro.   |
| Restablecer                  | Vuelve el borrador al diseño por defecto. Guardar un diseño igual al de defecto **borra** la preferencia, así el usuario recibe las mejoras futuras del diseño por defecto. |
| Dónde se edita               | Desde 1024 px de ancho. En tablet el diseño se adapta a la mitad de columnas y en celular se apila en orden de lectura, sin editar ni guardar.                              |
| Alcance                      | Por usuario.                                                                                                                                                                |
| Favoritos                    | Por pantalla y por tipo de entidad, en el orden del usuario, como mucho 50. Se guardan **al instante** (con Deshacer), sin pasar por Guardar diseño.                        |
| Orden del resto de una lista | "Mover al principio" y "Mover al final" para elementos no fijados valen **solo durante la visita**: no se guardan.                                                          |

## Contrato compartido (`packages/shared/src/view-layouts/`)

- `layout.ts`: `viewLayoutSchema`. Un diseño es `{ version, items }`, y cada ítem `{ id, x, y, w, h, hidden, presentation, settings }` en celdas (columna y fila desde 0). Como mucho 50 bloques y 400 filas.
- `grid.ts`: geometría pura (`rectsOverlap`, `readingOrder`, `compactInOrder`, `compactVertical`).
- `catalog.ts`:
  - `defineViewCatalog` declara una pantalla: columnas, roles, tipos de favoritos y, para cada bloque, tamaños mínimo/máximo/por defecto, presentaciones (la primera es la de defecto) y ajustes (`z.object` con todos sus campos con valor por defecto). Falla al cargar si el catálogo es incoherente.
  - `validateLayout` lo usa la API antes de guardar: todos los bloques una vez, dentro de la grilla, con tamaños, presentaciones y ajustes válidos y sin superposiciones entre visibles.
  - `reconcileLayout` lo usan la API y la web al leer. **Nunca falla**: descarta bloques desconocidos o repetidos, corrige tamaños y ajustes, agrega al final los bloques nuevos y compacta. Así un catálogo nuevo nunca rompe un diseño guardado.
- `keys.ts`: `VIEW_KEYS` (pantallas) y `FAVORITE_ENTITY_TYPES`.
- `index.ts`: `viewCatalogs`, `MAX_FAVORITES` y los esquemas de las respuestas y pedidos de la API.

Cuando cambia un catálogo (bloques, tamaños o ajustes), se incrementa su `version`. No hace falta migrar los diseños guardados: se reconcilian al leerlos.

## Base de datos

- `UserViewPreference`: una fila por `(userId, viewKey)` con `version` y `layout` (`Json`), validado con Zod al escribir y reconciliado al leer.
- `UserFavorite`: una fila por `(userId, viewKey, entityType, entityId)` con `position`. `entityId` apunta a `Site`, `User` (vigilador) o `Client` según `entityType`, sin clave foránea: la visibilidad se verifica al escribir y al leer.
- Las dos tablas están en `COMPANY_ID_MODELS`: toda consulta queda limitada a la empresa del usuario. Se borran en cascada con el usuario.

## API

| Método   | Ruta                              | Comportamiento                                                                                                                                             |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/mis-preferencias/vistas/:vista` | Diseño propio reconciliado, o `{ layout: null }` si usa el de defecto.                                                                                     |
| `PUT`    | `/mis-preferencias/vistas/:vista` | Valida contra el catálogo (400 con `issues`). Control optimista con `baseUpdatedAt`: si otro guardó después, **409** con `code: view_preference_conflict`. |
| `DELETE` | `/mis-preferencias/vistas/:vista` | Vuelve al diseño por defecto (204).                                                                                                                        |
| `GET`    | `/mis-favoritos/:vista/:tipo`     | Ids fijados en orden; omite los desactivados o que el usuario ya no puede ver.                                                                             |
| `PUT`    | `/mis-favoritos/:vista/:tipo`     | Reemplaza la lista completa. 400 si algún id no existe o no es visible para el usuario.                                                                    |

- Una pantalla desconocida da 404 y un rol que no está en `catalog.roles` da 403.
- La visibilidad de favoritos pasa por `FAVORITE_VISIBILITY_PORT` (adaptador Prisma con el cliente por empresa, que ya limita al supervisor a sus predios): el módulo no lee las tablas de otros dominios.
- Tests: `view-preferences.service.spec.ts`, `favorites.service.spec.ts` y `test/view-preferences.e2e-spec.ts` (guardar, 409 entre pestañas, aislamiento entre empresas, restablecer y favoritos ajenos).

## Web

### Piezas genéricas (`apps/web/src/lib/`)

| Pieza                                                                   | Para qué                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout-grid/engine.ts`                                                 | Motor puro e inmutable: `moveItem`, `resizeItem`, `stepItem`, `stepSize`, `setHidden`, `setPresentation`, `setSettings`, `scaleLayout`. Devuelve la **misma referencia** si una acción no cambia nada.                                            |
| `layout-grid/editor-state.ts`                                           | Reducer del editor: modo vista/edición, borrador, historial de deshacer (20 pasos) y **gestos**: un arrastre entero es un solo paso, y cancelarlo vuelve a como estaba.                                                                           |
| `layout-grid/use-view-layout.ts` y `use-view-layout-editor.ts`          | Leer el diseño, editarlo, guardarlo (o borrarlo si es el de defecto) y resolver el 409 ("Seguir con mis cambios" o "Ver el diseño guardado"). Avisa con `beforeunload` si se cierra con cambios.                                                  |
| `layout-grid/layout-grid.tsx`                                           | Dibuja con CSS Grid (filas de 48 px, separación de 24 px) en orden de lectura. En edición, el orden del DOM queda **fijo**: moverlo durante un arrastre haría perder la captura del puntero y el foco.                                            |
| `layout-grid/editable-item.tsx`, `edit-toolbar.tsx`, `blocks-panel.tsx` | Asas de mover y redimensionar (puntero y teclado), barra de edición y panel de bloques (visibilidad, presentación y ajustes).                                                                                                                     |
| `interaction/`                                                          | `usePointerDrag` (captura del puntero, Escape cancela, activación por mantener apretado), `useKeyboardGrab` (Enter o Espacio toma, flechas mueven, Escape cancela) y `useAnnouncer` (región `aria-live` con nombre).                              |
| `sortable-list/`                                                        | `reorder.ts` (puro: mover, fijar, separar fijados, orden de sesión y `mergeVisibleOrder`), `useSortableDrag` (arrastre de filas con `transform`, sin reordenar el DOM) y `RowMenu` (menú ⋮ que además es asa de arrastre al mantenerlo apretado). |

### Accesibilidad

- Todo lo que se hace con el puntero se puede hacer con el teclado. Las asas se toman con Enter o Espacio, las flechas mueven o redimensionan de a un paso y cada paso se anuncia ("Cumplimiento: columna 1, fila 6, 12 de ancho y 8 de alto"). Ctrl+Z deshace mientras se edita.
- El menú ⋮ es la alternativa de un solo toque al arrastre de filas (WCAG 2.5.7).
- En edición, el contenido de los bloques queda `inert`: el foco solo recorre las asas.
- Cada gráfico es decorativo para el lector de pantalla y lleva al lado su tabla equivalente.

### Favoritos (`apps/web/src/features/favoritos/use-favorites.ts`)

Actualización optimista: la lista cambia enseguida y, si la API falla, vuelve a la anterior y lo avisa. Cada cambio deja un aviso con **Deshacer**. Al reordenar solo los fijados que se ven, `mergeVisibleOrder` conserva el lugar de los que no aparecen (por ejemplo, un predio fijado sin rondas en el período); guardar solo los visibles los borraría sin aviso.

## Agregar otra pantalla personalizable

1. **Catálogo** en `packages/shared/src/view-layouts/<pantalla>.ts` con `defineViewCatalog`: columnas, roles, tipos de favoritos, bloques y diseño por defecto. Agregar la clave a `VIEW_KEYS` y el catálogo a `viewCatalogs`. Volver a generar el paquete (`pnpm --filter @garita/shared build`).
2. **Bloques** en la feature: un componente por bloque que recibe `{ item }` y parsea sus ajustes con el catálogo (`catalog.widgets.<id>.settings.parse(item.settings)`), un registro `satisfies Record<IdDeBloque, ComponentType<WidgetProps>>` (no compila si falta uno) y las descripciones del panel (textos de presentaciones y ajustes), con un test que las compare contra el catálogo como `block-descriptions.test.ts`.
3. **Página**: `useViewLayoutEditor(catalogo)`, `<EditToolbar>` con `<BlocksPanel>` en las acciones de `PageHeader`, y `<LayoutGrid>` con `edit` mientras se edita.
4. **Favoritos** (opcional): `useFavorites(vista, tipo)` con `partitionPinned`, `RowMenu` y `useSortableDrag`, como en `sites-widget.tsx`. El tipo debe estar en `favoriteTypes` del catálogo.

La API no necesita cambios: valida contra el catálogo de la pantalla nueva.

## Pendientes y límites conocidos

- **Navegación interna con cambios sin guardar:** la app usa `BrowserRouter`, que no permite bloquear la navegación (`useBlocker` requiere un router de datos). Hoy solo se avisa al cerrar o recargar la pestaña. Si se migra a `createBrowserRouter`, sumar `useBlocker` en `use-view-layout-editor.ts`.
- **Zona horaria de los períodos del Resumen:** la web no conoce la zona de la empresa antes de pedir un informe y usa `America/Argentina/Buenos_Aires`, igual que Cumplimiento (`features/resumen/queries.ts`). Si se agrega a `/auth/me`, usarla ahí.
- **Favoritos de vigiladores y clientes:** la API y el hook ya los admiten, pero hoy el Resumen solo lista predios.
- **Casilleros predio × día** (propuesta B): necesitan que `/reportes/rondas` devuelva el cumplimiento cruzado por predio y día.

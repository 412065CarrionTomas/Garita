# Vistas personalizables y favoritos

Algunas pantallas del panel se arman con **bloques** que cada usuario puede mover, redimensionar, ocultar y mostrar de otra forma. El primer uso es el **Resumen de la empresa** del administrador (`/resumen`). El diseño se guarda por usuario y por pantalla. Además, cada pantalla puede tener **favoritos**: entidades (predios, vigiladores, clientes) que el usuario fija arriba de sus listas con su propio orden.

Todo está pensado para reutilizarse en otras pantallas: el contrato vive en `@garita/shared`, la API no conoce los bloques más allá del catálogo, y la web separa un motor puro de los componentes.

## Reglas del producto

| Regla                        | Decisión                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diseño por defecto           | Cada pantalla define el suyo en su catálogo. En el Resumen es la propuesta A ("Foja de guardia").                                                                                                                                        |
| Guardado del diseño          | **Explícito.** Mover, redimensionar u ocultar cambia un borrador; solo **Guardar diseño** lo persiste. Cancelar con cambios pide confirmación.                                                                                           |
| Reacomodo                    | **Ubicación libre:** el bloque queda donde se suelta, aunque deje un hueco. Los que pisa bajan lo justo, en cascada, y nadie sube. Durante el gesto se recalcula desde el diseño de antes: si el bloque se aleja, los empujados vuelven. |
| Tamaños                      | Casi libres: grilla de 96 columnas y filas de 8 px. Cada bloque tiene un **mínimo por presentación** (lo justo para que se entienda: título y unas dos filas, o un gráfico legible); el texto que no entra se corta con "…".             |
| Restablecer                  | Vuelve el borrador al diseño por defecto. Guardar un diseño igual al de defecto **borra** la preferencia, así el usuario recibe las mejoras futuras del diseño por defecto.                                                              |
| Dónde se edita               | Desde 1024 px de ancho. En tablet el diseño se adapta a la mitad de columnas y en celular se apila en orden de lectura, sin editar ni guardar.                                                                                           |
| Alcance                      | Por usuario.                                                                                                                                                                                                                             |
| Favoritos                    | Por pantalla y por tipo de entidad, en el orden del usuario, como mucho 50. Se guardan **al instante** (con Deshacer), sin pasar por Guardar diseño.                                                                                     |
| Orden del resto de una lista | "Mover al principio" y "Mover al final" para elementos no fijados valen **solo durante la visita**: no se guardan.                                                                                                                       |

## Contrato compartido (`packages/shared/src/view-layouts/`)

- `layout.ts`: `viewLayoutSchema`. Un diseño es `{ version, items }`, y cada ítem `{ id, x, y, w, h, hidden, presentation, settings }` en celdas (columna y fila desde 0). Como mucho 50 bloques y 2000 filas.
- `grid.ts`: geometría pura (`rectsOverlap`, `readingOrder`, `resolveCollisions` para bajar lo justo sin subir a nadie, `compactInOrder` para la vista apilada, `scaleRects`).
- `catalog.ts`:
  - `defineViewCatalog` declara una pantalla: columnas, roles, tipos de favoritos y, para cada bloque, tamaños mínimo/máximo/por defecto (con `minByPresentation` para las presentaciones que necesitan otro mínimo; `widgetMinSize` lo resuelve), presentaciones (la primera es la de defecto) y ajustes (`z.object` con todos sus campos con valor por defecto). Falla al cargar si el catálogo es incoherente.
  - `validateLayout` lo usa la API antes de guardar: todos los bloques una vez, dentro de la grilla, con tamaños, presentaciones y ajustes válidos y sin superposiciones entre visibles.
  - `reconcileLayout` lo usan la API y la web al leer. **Nunca falla**: descarta bloques desconocidos o repetidos, corrige tamaños y ajustes, agrega al final los bloques nuevos y baja los que quedaron superpuestos sin subir a nadie (`settleLayoutItems`). Así un catálogo nuevo nunca rompe un diseño guardado.
- `keys.ts`: `VIEW_KEYS` (pantallas) y `FAVORITE_ENTITY_TYPES`.
- `index.ts`: `viewCatalogs`, `MAX_FAVORITES` y los esquemas de las respuestas y pedidos de la API.

Cuando cambia un catálogo (bloques, tamaños o ajustes), se incrementa su `version`. Los diseños guardados se reconcilian al leerlos, así que agregar o quitar bloques o cambiar límites no necesita migración. Si cambia **el significado de las celdas** (p. ej. una grilla más fina), el catálogo declara `migrations: { [versiónNueva]: (items) => items }`; `reconcileLayout` aplica en orden las posteriores a la versión guardada, antes de normalizar. `scaleRects` (en `grid.ts`) cubre el caso de cambiar la resolución. Un diseño sin versión no se migra. Ejemplo: el Resumen pasó en la versión 3 de 12 columnas y filas de 72 px a 24 columnas y filas de 24 px (`scaleRects(items, { columns: 2, rows: 3 })`), y en la 4 a 96 columnas y filas de 8 px (`{ columns: 4, rows: 3 }`).

## Base de datos

- `UserViewPreference`: una fila por `(userId, viewKey)` con `version` y `layout` (`Json`), validado con Zod al escribir y reconciliado al leer.
- `UserFavorite`: una fila por `(userId, viewKey, entityType, entityId)` con `position`. `entityId` apunta a `Site`, `User` (vigilador) o `Client` según `entityType`, sin clave foránea: la visibilidad se verifica al escribir y al leer.
- Las dos tablas están en `COMPANY_ID_MODELS`: toda consulta queda limitada a la empresa del usuario. Se borran en cascada con el usuario.

## API

| Método   | Ruta                              | Comportamiento                                                                                                                                             |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/mis-preferencias/vistas/:vista` | Diseño propio reconciliado, o `{ layout: null }` si usa el de defecto.                                                                                     |
| `PUT`    | `/mis-preferencias/vistas/:vista` | Valida contra el catálogo (400 con `issues`). Control optimista con `baseUpdatedAt`: si otro guardó después, **409** con `code: view_preference_conflict`. |
| `DELETE` | `/mis-preferencias/vistas/:vista` | Vuelve al diseño por defecto (204). Con `?baseUpdatedAt=` responde **409** si otro guardó después.                                                         |
| `GET`    | `/mis-favoritos/:vista/:tipo`     | Ids fijados en orden; omite los desactivados o que el usuario ya no puede ver.                                                                             |
| `PUT`    | `/mis-favoritos/:vista/:tipo`     | Reemplaza la lista completa. 400 si algún id no existe o no es visible para el usuario.                                                                    |
| `GET`    | `/reportes/rondas/casilleros`     | Cumplimiento de cada predio día por día para el bloque Casilleros. Período local `[desde, hasta)` de hasta 31 días (400 si es más largo).                  |

- Una pantalla desconocida da 404 y un rol que no está en `catalog.roles` da 403.
- La visibilidad de favoritos pasa por `FAVORITE_VISIBILITY_PORT` (adaptador Prisma con el cliente por empresa, que ya limita al supervisor a sus predios): el módulo no lee las tablas de otros dominios.
- Tests: `view-preferences.service.spec.ts`, `favorites.service.spec.ts` y `test/view-preferences.e2e-spec.ts` (guardar, 409 entre pestañas, aislamiento entre empresas, restablecer y favoritos ajenos).

## Web

### Piezas genéricas (`apps/web/src/lib/`)

| Pieza                                                                   | Para qué                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout-grid/engine.ts`                                                 | Motor puro e inmutable: `moveItem`, `resizeItem`, `stepItem`, `stepSize`, `setHidden`, `setPresentation`, `setSettings`, `scaleLayout`. Devuelve la **misma referencia** si una acción no cambia nada.                                                                                                                                                                                                        |
| `layout-grid/editor-state.ts`                                           | Reducer del editor: modo vista/edición, borrador, historial de deshacer (20 pasos) y **gestos**: un arrastre entero es un solo paso, y cancelarlo vuelve a como estaba.                                                                                                                                                                                                                                       |
| `layout-grid/use-view-layout.ts` y `use-view-layout-editor.ts`          | Leer el diseño, editarlo, guardarlo (o borrarlo si es el de defecto) y resolver el 409 ("Seguir con mis cambios" o "Ver el diseño guardado").                                                                                                                                                                                                                                                                 |
| `layout-grid/layout-grid.tsx`                                           | Dibuja con CSS Grid sin huecos entre celdas (filas de `GRID_ROW` = 8 px); cada bloque deja `GRID_GUTTER` = 24 px a la derecha y abajo como relleno propio, y la grilla se extiende esos 24 px a la derecha en orden de lectura; en una sola columna cada bloque toma su alto natural. En edición, el orden del DOM queda **fijo**: moverlo durante un arrastre haría perder la captura del puntero y el foco. |
| `layout-grid/editable-item.tsx`, `edit-toolbar.tsx`, `blocks-panel.tsx` | Asas de mover y redimensionar (puntero y teclado), barra de edición y panel de bloques (visibilidad, presentación y ajustes).                                                                                                                                                                                                                                                                                 |
| `layout-grid/drag-preview.ts` y `grid-metrics.ts`                       | Geometría pura del gesto: medir la grilla, pasar píxeles a celdas y calcular dónde se dibuja el bloque mientras sigue al puntero, dentro de los mismos límites que aplica el motor al soltar.                                                                                                                                                                                                                 |
| `interaction/`                                                          | `usePointerDrag` (captura del puntero, Escape cancela, activación por mantener apretado), `useKeyboardGrab` (Enter o Espacio toma, flechas mueven, Escape cancela) y `useAnnouncer` (región `aria-live` con nombre) y `useFlipAnimation` (desliza a su lugar nuevo los elementos con `data-flip-id`, salvo el que tiene `data-flip-skip`; respeta el movimiento reducido).                                    |
| `sortable-list/`                                                        | `reorder.ts` (puro: mover, fijar, separar fijados, orden de sesión y `mergeVisibleOrder`), `useSortableDrag` (arrastre de filas con `transform`, sin reordenar el DOM) y `RowMenu` (menú ⋮ que además es asa de arrastre al mantenerlo apretado).                                                                                                                                                             |

### Accesibilidad

- Todo lo que se hace con el puntero se puede hacer con el teclado. Las asas se toman con Enter o Espacio, las flechas mueven o redimensionan de a un paso (`keyboardStep`: unas 2 columnas y 3 filas, unos 30 × 24 px) y cada paso se anuncia ("Cumplimiento: columna 1, fila 55, 64 de ancho y 72 de alto"). Ctrl+Z deshace mientras se edita.
- El menú ⋮ es la alternativa de un solo toque al arrastre de filas (WCAG 2.5.7).
- En edición, el contenido de los bloques queda `inert`: el foco solo recorre las asas.
- Cada gráfico es decorativo para el lector de pantalla y lleva al lado su tabla equivalente.

### Favoritos (`apps/web/src/features/favoritos/use-favorites.ts`)

Actualización optimista: la lista cambia enseguida y, si la API falla, vuelve a la anterior y lo avisa. Cada cambio deja un aviso con **Deshacer**. Al reordenar solo los fijados que se ven, `mergeVisibleOrder` conserva el lugar de los que no aparecen (por ejemplo, un predio fijado sin rondas en el período); guardar solo los visibles los borraría sin aviso.

## Agregar otra pantalla personalizable

1. **Catálogo** en `packages/shared/src/view-layouts/<pantalla>.ts` con `defineViewCatalog`: columnas, roles, tipos de favoritos, bloques y diseño por defecto. Agregar la clave a `VIEW_KEYS` y el catálogo a `viewCatalogs`. Volver a generar el paquete (`pnpm --filter @garita/shared build`).
2. **Bloques** en la feature: un componente por bloque que recibe `{ item }` y parsea sus ajustes con el catálogo (`catalog.widgets.<id>.settings.parse(item.settings)`), un registro `satisfies Record<IdDeBloque, ComponentType<WidgetProps>>` (no compila si falta uno) y las descripciones del panel (textos de presentaciones y ajustes), con un test que las compare contra el catálogo como `block-descriptions.test.ts`.
3. **Página**: `useViewLayoutEditor(catalogo)`, `<EditToolbar>` con `<BlocksPanel>` en las acciones de `PageHeader`, y `<LayoutGrid>` con `edit` mientras se edita.
4. **Favoritos** (opcional): para un ranking de cumplimiento, `ComplianceRanking` (`features/resumen/compliance-ranking.tsx`) ya trae fijados, menú ⋮ y arrastre, como en `sites-widget.tsx` y `guards-widget.tsx`. Para otras listas, `useFavorites(vista, tipo)` con `partitionPinned`, `RowMenu` y `useSortableDrag`. El tipo debe estar en `favoriteTypes` del catálogo.

La API no necesita cambios: valida contra el catálogo de la pantalla nueva.

## Bloque Casilleros por predio

De la propuesta B. Está en el catálogo pero **oculto** en el diseño por defecto: cada usuario lo muestra desde **Bloques** y elige 7, 14 o 30 días.

- `computeSiteDayGrid` (`packages/shared/src/reports/compliance.ts`) arma un casillero por predio y día, y `siteDayStatus` le da un estado: `failed` (alguna no realizada o incompleta), `late`, `ok`, `pending` (sin sincronizar o en revisión) o `none` (sin rondas). La API (`reports.service.ts`) y los tests usan la misma función.
- La web (`widgets/site-days-widget.tsx`) lo dibuja como una tabla real con predios en filas y días en columnas. Cada estado se distingue por forma y color, lleva su texto para el lector de pantalla y aparece en las referencias. En celular solo la tabla se desplaza de costado: es una región que se alcanza con el teclado.

## Pendientes y límites conocidos

- **Cambios sin guardar:** `useLeaveGuard` (`apps/web/src/lib/use-leave-guard.tsx`) pide confirmación al cerrar o recargar la pestaña y al tocar un enlace interno, frenando el clic antes de que el router navegue. El botón Atrás del navegador no se intercepta: con `BrowserRouter` no hay forma confiable (`useBlocker` requiere un router de datos). Si se migra a `createBrowserRouter`, sumar `useBlocker` en ese hook.
- **Zona horaria de los períodos del Resumen:** la web no conoce la zona de la empresa antes de pedir un informe y usa `America/Argentina/Buenos_Aires`, igual que Cumplimiento (`features/resumen/queries.ts`). Si se agrega a `/auth/me`, usarla ahí.
- **Favoritos de clientes:** la API y el hook los admiten, pero el informe de cumplimiento no trae datos por cliente, así que el Resumen no tiene un bloque que los liste. Los predios y los vigiladores sí se pueden fijar.

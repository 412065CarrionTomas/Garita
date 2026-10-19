# Sistema de diseño de Garita

Fuente de verdad visual del panel web y de la app del vigilador. Los **valores** viven en `packages/tokens` (`@garita/tokens`); este documento dice **cómo usarlos**. Si algo no está acá, se decide con los principios y se anota en este archivo.

## 1. Principios

1. **Es una herramienta de trabajo, no una landing.** El panel es denso y legible (tablas, filtros, formularios claros). La app se usa de noche, con guantes, con una mano y bajo el sol: contraste alto y objetivos grandes.
2. **El color informa, no decora.** La marca es neutra (`primary`: casi negro en claro, casi blanco en oscuro) y el único acento de color es el ámbar. El ámbar de seguridad vial (`signal`) se usa **solo** para lo que pide atención ahora: el turno en curso, el punto que falta escanear, la acción principal del vigilador, el ítem activo del menú. Si todo es ámbar, nada lo es.
3. **El estado nunca va solo en color.** Todo estado es punto + texto (`StatusBadge` en web, `Badge` en la app). Los errores dicen qué pasó y cómo seguir.
4. **Modo claro y oscuro son de primera clase.** Nada se diseña con un solo tema: cada pantalla se revisa en los dos.
5. **Una acción principal por pantalla.** Un solo botón `default`/`primary` (o `signal` en la app); el resto, `outline`, `secondary` o `ghost`.
6. **Bordes antes que sombras.** Las superficies se separan con borde y fondo (`card` sobre `background`). Sombra solo en lo flotante (menús, diálogos), que ya la trae shadcn.
7. **Español rioplatense, voseo y oraciones en minúscula** ("Guardar cambios", no "Enviar"; "Ingresá", no "Ingrese"). Un botón dice lo que hace y mantiene su nombre en todo el flujo.

## 2. Tokens

Se consumen por nombre semántico; **nunca hex, rgb ni `oklch` sueltos en pantallas** ni clases de color de la paleta de Tailwind (`bg-red-500`, `text-amber-800`, `border-gray-300`).

| Token                                                            | Uso                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `background`                                                     | Fondo de la pantalla                                                                              |
| `card` / `cardForeground`                                        | Superficies elevadas: tarjetas, tablas, paneles                                                   |
| `popover`                                                        | Menús y diálogos                                                                                  |
| `foreground` / `mutedForeground`                                 | Texto principal / secundario (ayudas, metadatos, encabezados de tabla)                            |
| `primary` / `primaryForeground`                                  | Marca y acción principal                                                                          |
| `secondary`, `muted`, `accent`                                   | Fondos tenues: botón secundario, zonas apagadas, hover                                            |
| `border`                                                         | Separadores y bordes de tarjetas                                                                  |
| `input`                                                          | Borde de campos (cumple 3:1)                                                                      |
| `ring`                                                           | Foco visible                                                                                      |
| `signal` / `signalForeground`                                    | Atención inmediata (ver principio 2)                                                              |
| `success`, `warning`, `danger`, `info` + `*Soft` + `*Foreground` | Estados. Texto en el color pleno sobre su `*Soft`; `*Foreground` es el texto sobre el color pleno |
| `sidebar*`                                                       | Menú lateral del panel (neutro, un escalón por encima o por debajo del fondo)                     |

`packages/tokens/src/tokens.test.ts` verifica que cada par de texto cumpla WCAG AA (4.5:1) en los dos temas. **Si cambiás un valor, corré ese test.**

Escalas (`@garita/tokens`): `space` (múltiplos de 4), `radius` (`sm` 6, `md` 8, `lg` 10, `xl` 14, `2xl` 20), `fontSize` (`xs` 12, `sm` 14, `base` 16, `lg` 18, `xl` 22, `2xl` 28, `3xl` 34), `fontWeight`, `touch` (`min` 44, `action` 56), `motion`.

### Tipografía

**Geist** en web y en la app. Escala de uso:

| Rol                | Web                                                    | App                                   |
| ------------------ | ------------------------------------------------------ | ------------------------------------- |
| Título de pantalla | `text-2xl font-semibold tracking-tight` (`PageHeader`) | `Text variant="title"`                |
| Título de sección  | `text-lg font-semibold`                                | `heading` / `subheading`              |
| Cuerpo             | `text-sm` (tablas y formularios) o `text-base`         | `body` (16, nunca menos)              |
| Etiquetas de campo | `Label` (`text-sm font-medium`)                        | `label`                               |
| Metadatos, ayudas  | `text-sm text-muted-foreground` / `text-xs`            | `caption` / `color="mutedForeground"` |

Números, horas y patentes: `tabular-nums` en web. Sin MAYÚSCULAS para etiquetas ni textos decorativos sobre los títulos.

## 3. Mapa de estados (mismo tono para el mismo estado en todo el producto)

| Estado                                              | Tono                              | Texto sugerido                              |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Turno programado                                    | `info`                            | Programado                                  |
| Turno sin vigilador asignado                        | `warning`                         | Sin asignar                                 |
| Turno en curso                                      | `signal`                          | En curso                                    |
| Turno cerrado                                       | `success`                         | Cerrado                                     |
| Turno cerrado automáticamente                       | `warning`                         | Cerrado por el sistema                      |
| Turno cancelado                                     | `neutral`                         | Cancelado                                   |
| Usuario activo / invitación pendiente / desactivado | `success` / `warning` / `neutral` | Activo / Invitación pendiente / Desactivado |
| Predio, cliente, punto o ronda activo / inactivo    | `success` / `neutral`             | Activo / Inactivo                           |
| Registro (escaneo) aceptado                         | `success`                         | Registrado                                  |
| Registro rechazado, fuera de rango o error          | `danger`                          | (la causa, en una frase)                    |
| Registro sospechoso grave / media / leve            | `danger` / `warning` / `info`     | Grave / Media / Leve                        |
| Sin señal / pendiente de enviar                     | `warning`                         | Sin señal / Pendiente de envío              |
| Enviando                                            | `info`                            | Enviando                                    |

## 4. Panel web (React + Tailwind v4 + shadcn `radix-nova`)

### 4.1 Piezas disponibles

`src/components/ui/`: `alert`, `alert-dialog`, `badge`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `native-select`, `select`, `separator`, `sheet`, `skeleton`, `switch`, `table`, `tabs`, `textarea`.
`src/components/`: `AppShell` (ya aplicado en `RoleLayout`), `PageHeader`, `EmptyState`, `StatusBadge`, `ThemeToggle`.
Íconos: `lucide-react`, siempre con `aria-hidden="true"` y acompañados de texto, salvo botones de ícono con `aria-label`.

**Reglas de uso**

- **`<select>` nativo → `NativeSelect` + `NativeSelectOption`**, no el `Select` de Radix. Mantiene el comportamiento y los tests (`selectOptions`, `getByLabelText`). Las props (`id`, `aria-label`, `value`, `onChange`, `required`) van al `<select>` interno.
- Campo = `Label` + `Input`/`Textarea`/`NativeSelect`, unidos con `htmlFor`/`id` **igual que hoy**. Error de campo: `<p id="x-error" className="text-sm text-danger">` con `aria-describedby` y `aria-invalid` en el campo; mensajes con `role="alert"` cuando aparecen tras enviar.
- No se cambian textos, roles ARIA, `aria-label`, `name`, orden del foco ni la lógica. **Los tests existentes no se debilitan**: si un selector se rompe por el markup nuevo, se ajusta el selector manteniendo la aserción.
- Nunca `className="rounded border p-3"` crudo como contenedor: usar `Card` (o `Table` para datos tabulares).
- Clases de color solo con tokens: `bg-card`, `text-muted-foreground`, `border-border`, `text-danger`, `bg-warning-soft`, etc.
- Responsive: mobile-first; el contenido debe usarse a 360 px sin scroll horizontal (las tablas anchas van en un contenedor `overflow-x-auto`).

### 4.2 Plantillas de pantalla

**Estructura**: `<section aria-labelledby="…">` → `PageHeader` (título, una línea de ayuda, acción principal a la derecha) → contenido. Separación vertical `space-y-6`.

**Listado de datos (Personal, Clientes, Turnos, Predios)**: filtros en una fila sobre la tabla (`NativeSelect` + `Input` de búsqueda si ya existe), `Card` con `Table` adentro (encabezados en `text-muted-foreground`, filas con `hover:bg-muted/50`), estado en `StatusBadge`, acciones de fila con `Button variant="ghost" size="sm"` o `DropdownMenu` si son más de dos. Vacío → `EmptyState` con la acción que lo resuelve. Cargando → `Skeleton` de 3 a 5 filas con `role="status"` y texto accesible. Error → `Alert variant="destructive"` con `role="alert"`. Paginación: botones `outline` + "Página x de y".

**Alta / edición**: el formulario de alta que hoy está siempre visible pasa a un `Dialog` abierto desde el botón primario del `PageHeader` ("Agregar personal"), **conservando el mismo `<form>` y sus `aria-label`**. Si el formulario ya está en un `Dialog` (edición), solo se estiliza. Campos en grilla `grid gap-4 sm:grid-cols-2`; ancho completo para campos largos; acciones al pie alineadas a la derecha: cancelar (`outline`) y confirmar (`default`).

**Confirmación destructiva**: `AlertDialog` con título que nombra el objeto, consecuencias en una lista, acción en `variant="destructive"` con el verbo ("Dar de baja"), cancelar primero en el orden de foco.

**Ficha / detalle**: `PageHeader` con volver (enlace) + título + `StatusBadge`; datos en `Card` con lista de definiciones (`dl`); secciones relacionadas en `Tabs` solo si hay tres o más.

**Pantallas de acceso (login, recuperar, activar)**: sin `AppShell`; contenedor centrado `max-w-md` sobre `bg-background`, marca arriba (logo + "Garita"), `Card` con el formulario, enlaces secundarios debajo, `ThemeToggle` no hace falta. Botón principal a todo el ancho.

**Paneles embebidos** (`CheckpointsPanel`, `RoundsPanel` dentro de la ficha del predio): `Card` con encabezado propio (`h3`) y mismo patrón de lista/alta que arriba; **no cambiar sus props ni su firma**, porque los usa `sites-page`.

## 5. App del vigilador (React Native propio, sin librería de UI)

### 5.1 Piezas (`apps/mobile/src/ui`, import `@/ui`)

`Screen` (fondo + zona segura + margen 20; `scroll` para formularios), `Text` (variantes `display`, `title`, `heading`, `subheading`, `body`, `label`, `caption`; prop `color` = token), `Button` (`primary`, `secondary`, `outline`, `danger`, `signal`, `ghost`; `size="lg"` = 56 px para la acción principal; `loading`), `Input` (etiqueta visible + error + `trailing`), `Card`, `Badge` (`tone` + `label`), `Banner` (`tone`, `title`, rol `alert` por defecto), `ListItem` (fila tocable con `trailing`), `Loading`, `ThemeSwitch`, `useTheme()` (`colors`, `scheme`), `useStackOptions()`.

No hay librería de íconos a propósito (evita problemas de versiones con Expo). Los indicadores se arman con texto, `Badge` y formas simples (`View`).

### 5.2 Reglas

- **Nada de colores literales ni `fontSize` sueltos**: color por token (`useTheme().colors.x` o la prop `color`), tamaños por `Text`/`fontSize` de `@garita/tokens`, espacios por `space`. `StyleSheet.create` queda solo para layout (flex, gap, padding, radios).
- **Objetivos táctiles ≥ 44 px; acción principal 56 px.** Texto de cuerpo ≥ 16.
- **Accesibilidad intacta**: se conservan `accessibilityRole`, `accessibilityLabel`, `accessibilityLiveRegion` y los textos que usan los tests. `Button` ya expone `accessibilityLabel = label`.
- Una sola acción `primary`/`signal` por pantalla; "Cerrar sesión" y "Volver" son `ghost`/`outline`.
- Los fondos de la app salen de `Screen`/`Card`; el tema oscuro funciona sin código extra si se usan los componentes.
- Cámara/escáner (`scanner-screen`): el visor ocupa toda la pantalla; los controles flotan sobre fondo semitransparente oscuro **en los dos temas** (la cámara es siempre oscura); mensajes de resultado como `Banner`.

### 5.3 Plantillas de pantalla

- **Acceso (login, recuperar)**: `Screen scroll`, marca arriba ("Garita", `display`), `title`, campos `Input`, un `Button size="lg"`, enlace `ghost` debajo, `Banner tone="danger"` para errores del servidor, mostrar/ocultar contraseña con `trailing` (`Button variant="ghost"`).
- **Lista (Mis turnos)**: `title` + ayuda (`mutedForeground`), `ListItem` por turno con `Badge` de estado a la derecha, `Loading` / `Banner` de error con "Reintentar" / estado vacío con texto que orienta ("No tenés turnos en los próximos 14 días").
- **Turno en curso**: arriba una `Card` con el predio, el horario y el `Badge` "En curso" (`signal`) y el indicador de conexión (`Badge` Sin señal / Pendiente / Enviando); luego la acción principal `Button signal size="lg"` ("Escanear código QR"); debajo las ventanas con sus puntos pendientes en `Card`s (cada punto con su estado); "Cerrar turno" al final como `outline`/`danger` con confirmación como ya existe.
- **Permisos**: título, una `Card` por permiso (ubicación, cámara) que dice para qué se usa, y dos botones (Configurar permisos primario, Continuar secundario).
- **Configuración (admin/supervisor)**: `title`, `Banner` de NFC/mensajes, lista de predios como `ListItem` seleccionables, puntos como `Card` con su estado de etiqueta (`Badge`) y acciones; `ThemeSwitch` y "Cerrar sesión" al final.

## 6. Flujo de trabajo y verificación

- Antes de cerrar: `pnpm --filter <app> lint`, `typecheck`, `test` y `pnpm format:check`.
- Cada pantalla se mira **en claro y en oscuro**. Web: `pnpm --filter web dev` y el botón de tema del menú. App: el selector de apariencia (`ThemeSwitch`) o el modo del sistema.
- Un PR por worker, ramas desde `develop`, sin tocar archivos fuera de la propiedad asignada.

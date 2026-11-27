---
name: Garita
description: 'Foja: papel frío, tinta azul y un único sello rojo. Cada registro lleva su hora.'
colors:
  paper: '#F4F6F8'
  sheet: '#FFFFFF'
  sheet-tint: '#ECEFF3'
  ink: '#1B2540'
  ink-muted: '#56607A'
  rule: '#D7DCE5'
  rule-strong: '#6F7891'
  bar: '#1B2540'
  bar-ink: '#FFFFFF'
  bar-muted: '#B9C1D6'
  seal: '#A61E22'
  late-amber: '#8A5A00'
  ok-green: '#1E6B3C'
  info-blue: '#1B5BB0'
  paper-dark: '#0F1626'
  sheet-dark: '#161F34'
  sheet-tint-dark: '#1E2944'
  ink-dark: '#E6EAF4'
  ink-muted-dark: '#A3ACC4'
  rule-dark: '#2A3552'
  rule-strong-dark: '#7A84A3'
  bar-dark: '#0A101D'
  bar-ink-dark: '#E6EAF4'
  bar-muted-dark: '#A3ACC4'
  seal-dark: '#FF8A8D'
  late-amber-dark: '#F0B54A'
  ok-green-dark: '#6FD39A'
  info-blue-dark: '#8DB8FF'
typography:
  display:
    fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif'
    fontSize: '32px'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: '0.04em'
  headline:
    fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif'
    fontSize: '26px'
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: '0.04em'
  title:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: '0.1em'
  stamp:
    fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif'
    fontSize: '13px'
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: '0.07em'
  numeral:
    fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif'
    fontSize: '18px'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0.02em'
rounded:
  hairline: '1px'
  sm: '2px'
  md: '3px'
  lg: '4px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '20px'
  '2xl': '24px'
  '3xl': '32px'
components:
  nav-bar:
    backgroundColor: '{colors.bar}'
    textColor: '{colors.bar-ink}'
    height: '52px'
    padding: '0 20px'
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    typography: '{typography.title}'
    rounded: '{rounded.md}'
    height: '36px'
    padding: '0 14px'
  button-secondary:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '36px'
    padding: '0 14px'
  chip:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '5px 14px'
  chip-selected:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
  stamp:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    typography: '{typography.stamp}'
    rounded: '{rounded.hairline}'
    padding: '2px 9px'
  stamp-late:
    textColor: '{colors.late-amber}'
  stamp-seal:
    textColor: '{colors.seal}'
  stamp-now:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
  table-header:
    backgroundColor: '{colors.sheet-tint}'
    textColor: '{colors.ink-muted}'
    typography: '{typography.label}'
    height: '36px'
    padding: '0 20px'
  table-row:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    height: '56px'
    padding: '8px 20px'
  input:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '40px'
    padding: '8px 10px'
---

# Design System: Garita

## Overview

**Creative North Star: "La foja sellada"**

Una ronda es una foja: renglones numerados, un casillero que se marca al registrar y la hora estampada en un sello. El sistema entero se apoya en esa idea. Lo normal no hace ruido (tinta sobre papel); lo que falta se marca con el único rojo del sistema. Quien mira el panel debe poder saber en segundos si un turno está en orden, y quien usa la app de noche, con una mano y sin señal, debe ver siempre cuál es el próximo punto.

La densidad es alta pero ordenada: tablas con filetes finos, columnas alineadas, números tabulares. No hay tarjetas flotantes ni sombras; las superficies son hojas planas sobre un papel frío con una trama diagonal casi invisible. La tipografía condensada en mayúsculas pone el tono de formulario oficial en títulos, etiquetas y sellos; el texto corrido es un grotesco sobrio y legible.

Es un sistema de herramienta, no de marketing. Rechaza lo infantil (colores saturados, formas blandas, ilustraciones), el aspecto de tablero corporativo (métricas gigantes, tarjetas iguales con ícono) y la plantilla genérica (gris y ámbar, esquinas redondeadas).

**Key Characteristics:**

- Papel frío, tinta azul y un solo rojo de sello; el ámbar solo para demora; verde y azul informativo solo en confirmaciones y avisos.
- Estados siempre con forma y texto además de color.
- Hora y sincronización visibles en cada registro (sello de hora).
- Planas, con filetes de 1 px y radios de 2 a 4 px.
- Claro y oscuro de primera clase; el oscuro es "papel de noche", no una inversión.
- Un mismo lenguaje para el panel web y la app, con densidad distinta.

## Colors

Paleta de tres valores (tinta, papel, sello) más un ámbar de demora, una barra de navegación en tinta y, por decisión del proyecto, un verde de éxito y un azul informativo de uso acotado. Los valores viven en `@garita/tokens` (`packages/tokens/src/colors.ts`), que es la fuente de verdad.

### Primary

- **Tinta azul** (#1B2540 claro / #E6EAF4 oscuro): texto, bordes activos, botón principal, marcas de "registrado", barra de navegación y todo lo que está en orden. Es el color del sistema; lo que no pide atención va en tinta.

### Secondary

- **Sello rojo** (#A61E22 claro / #FF8A8D oscuro): únicamente fallas: punto sin registro, ventana no realizada, pánico, errores y "Revisar" en cumplimiento bajo. En una pantalla ocupa una fracción mínima; su rareza es lo que le da valor.
- **Ámbar de demora** (#8A5A00 claro / #F0B54A oscuro): solo demora: ventana o punto tardío, "+17 min", incidentes sin clasificar. Nunca decora y nunca marca una falla.

- **Verde de éxito** (#1E6B3C claro / #6FD39A oscuro): confirmaciones puntuales (registro enviado, alta exitosa, cierre de turno). No se usa para marcar "cumplido" en tablas ni ventanas: ahí manda la tinta.
- **Azul informativo** (#1B5BB0 claro / #8DB8FF oscuro): avisos neutros y ayudas (modo sin señal, información de contexto). Nunca marca una excepción.

Cada color de estado tiene un fondo tenue (`*Soft`) derivado de mezclarlo con la hoja; el texto va en el color pleno sobre ese fondo (contraste ≥ 4,5:1 verificado en `tokens.test.ts`).

### Neutral

- **Papel** (#F4F6F8 / #0F1626): fondo de pantalla. Lleva una trama diagonal de hairlines al 3% de tinta.
- **Hoja** (#FFFFFF / #161F34): superficie de tablas, formularios y paneles.
- **Hoja teñida** (#ECEFF3 / #1E2944): encabezados de tabla, fila seleccionada, hover.
- **Tinta atenuada** (#56607A / #A3ACC4): texto secundario, etiquetas, metadatos.
- **Filete** (#D7DCE5 / #2A3552): separadores de fila.
- **Filete fuerte** (#6F7891 / #7A84A3): bordes de controles y chips; cumple 3:1 de contraste sobre las hojas.
- **Barra** (#1B2540 / #0A101D): barra de navegación superior; sobre ella, texto #FFFFFF / #E6EAF4 y secundario #B9C1D6 / #A3ACC4.

### Named Rules

**La regla del único sello.** El rojo marca fallas y nada más. Si una pantalla lleva rojo en más de un puñado de elementos, algo está mal planteado. No se usa para botones destructivos "decorativos", títulos ni énfasis.

**La regla de lo normal sin color.** Lo cumplido, registrado o en curso va en tinta con un tilde. El color aparece solo en las excepciones, para que el ojo caiga primero en ellas. El verde y el azul no rompen la regla: son para confirmaciones y avisos puntuales, nunca para marcar lo cumplido en una tabla.

**La regla de la forma además del color.** Todo estado tiene forma y texto propios (tilde, tachado diagonal, recuadro punteado, sello invertido) para que funcione sin distinguir colores.

## Typography

**Display / Label / Stamp / Numeral:** Barlow Condensed (con Arial Narrow como respaldo)
**Body / Title:** Public Sans (con system-ui como respaldo)

**Character:** una condensada en mayúsculas con tracking abierto, de formulario oficial, para todo lo que es rótulo, título o dato corto, contra un grotesco sobrio para lo que se lee. Los números siempre son tabulares: las horas y los contadores deben alinear.

### Hierarchy

- **Display** (600, 32 px, 1, +0.04em, mayúsculas): título de cada pantalla del panel. Una vez por pantalla.
- **Headline** (600, 24 a 28 px, 1.1, +0.04em, mayúsculas): título de panel, de foja y de diálogo; en la app, 26 px y peso 700 para el título de pantalla.
- **Title** (600, 15 px, 1.25): nombre del predio o punto en una fila; en la app, 17 px.
- **Body** (400, 14 px, 1.45): texto corrido y celdas. Largo de línea 65 a 75 caracteres. En la app, 16 px como mínimo.
- **Label** (600, 12 px, +0.1em, mayúsculas): encabezados de tabla, rótulos de campo y de metadato.
- **Stamp** (600, 13 px, +0.07em, mayúsculas, tabulares): sellos de hora y de estado.
- **Numeral** (600, 17 a 20 px, tabulares): número de punto, contadores y horas en filas.

### Named Rules

**La regla de las cifras alineadas.** Toda hora y todo contador usan cifras tabulares. Una columna de horas que no alinea parece un error de registro.

**La regla de la condensada acotada.** La condensada en mayúsculas es para rótulos, títulos cortos, sellos y números. Nunca para párrafos ni para el nombre de una persona.

## Layout

Cada pantalla ocupa todo el ancho de la ventana; no hay columnas centradas de ancho fijo. La estructura es siempre la misma: barra de navegación superior de 52 px y, debajo, una de dos composiciones.

- **En vivo:** un panel izquierdo de ancho `clamp(640px, 28vw, 900px)` con la lista de rondas, que al elegir una pasa a ser la foja de esa ronda, y el mapa ocupando el resto. El mapa nunca queda cubierto por paneles flotantes.
- **Páginas:** título, filtros y hojas de ancho completo. Las pantallas anchas se parten en dos columnas (por ejemplo, tabla de cumplimiento a la izquierda y grilla ventana por ventana a la derecha) sin dejar vacíos laterales.

El ritmo es de 4 px. Las filas de tabla miden de 46 a 64 px; los encabezados, 34 a 36 px; el relleno horizontal de hojas y filas es de 20 px; la página tiene 24 a 28 px de margen. Más aire encima de un título que debajo.

En la app, la ronda se muestra en una ventana de cinco filas (dos anteriores, la actual y dos siguientes) que se desliza, sirva para 6 o para 40 puntos. La acción principal mide 56 px o más y las demás zonas táctiles, 44 px como mínimo. La barra inferior tiene cuatro destinos: Ronda, Incidente, Envío y Pánico.

## Elevation & Depth

Sin sombras. La profundidad se logra con tono (hoja blanca sobre papel; hoja teñida para lo seleccionado), con filetes de 1 px y con bordes de 1,5 px en los controles. La selección es un recuadro interior de 2 px en tinta. Las únicas excepciones son los avisos temporales (toasts) y los diálogos, que llevan borde de 2 px en tinta y un velo oscuro detrás.

### Named Rules

**La regla de lo plano.** Ninguna superficie lleva sombra en reposo ni en hover. El estado se expresa con tono, borde y recuadro, no con elevación.

## Shapes

Lenguaje rectangular de formulario: radios de 2 a 4 px (controles 3, botones de la app 4, sellos casi a escuadra). Los chips de un grupo se pegan y comparten borde, como un control segmentado. Las ventanas de una ronda son casilleros chicos (10 × 16 px en filas, 24 × 26 en grillas); los puntos en el mapa y en la tabla son cuadrados; solo el camino lineal usa círculos (estaciones). Los sellos son rectángulos con borde de 1,5 px; el sello de falla lleva un segundo contorno y una inclinación de −2°. El ícono de la app es el único elemento circular: un sello de doble aro.

## Components

### Barra de navegación

Barra de 52 px en tinta con el logotipo (ícono y GARITA en condensada con tracking), pestañas de texto y, a la derecha, el reloj en un sello y el menú de la cuenta (estado de las notificaciones, preferencias, suscripción, cierre de sesión y, al final, el interruptor de tema claro u oscuro; sin elección guardada manda el sistema). La pestaña activa lleva 3 px de subrayado y texto en peso 600. Las secciones afines se agrupan en una pestaña con desplegable (Pendientes, Incidentes, Gestión); bajo 1280 px toda la navegación pasa a un panel lateral con los grupos desplegados bajo su rótulo. Los contadores son sellos que solo aparecen si hay pendientes: rojo para pánico y rondas en revisión, ámbar para incidentes por clasificar y recuadro en tinta para avisos. Un pánico activo suma además un sello rojo directo en la barra, la campana de activar notificaciones queda a la vista hasta que el dispositivo las tenga activas, y la pérdida de la conexión en vivo se avisa con un sello punteado.

### Botones

- **Forma:** radio de 3 px (4 px en la app), alto de 36 px en el panel, 44 px táctiles y 56 o 62 px la acción principal de la app.
- **Primario:** fondo tinta, texto papel. En la app, el texto va en condensada mayúscula con tracking.
- **Secundario:** fondo hoja, borde de 1,5 px en tinta.
- **Hover / Foco:** hover aclara el fondo hacia la hoja teñida; foco visible de 3 px en tinta con 2 px de separación. En carga, el botón muestra un indicador y su etiqueta de acción en gerundio ("Creando…").

### Chips y filtros

Control segmentado: bordes de 1,5 px en filete fuerte, esquinas redondeadas solo en los extremos; el seleccionado se invierte (fondo tinta, texto papel). Siempre con `aria-pressed`.

### Sellos

La pieza distintiva. Recuadro de 1,5 px con texto condensado en mayúsculas y cifras tabulares, que acompaña a toda hora registrada y a todo estado. Variantes: **normal** (tinta), **tarde** (ámbar), **falla** (rojo, doble contorno, inclinado), **punteado** (sin señal, programado, interno) y **ahora** (invertido: fondo tinta, texto papel).

### Tablas

Encabezado en hoja teñida con etiquetas condensadas; filas separadas por filetes de 1 px; columnas definidas por una grilla (`grid-template-columns`) por tabla. La fila seleccionada o actual lleva el recuadro interior de 2 px. Estados vacíos con título en condensada y una línea de recuperación.

### Ventanas de ronda

Hilera de casilleros, uno por ventana: **a tiempo** relleno en tinta, **tardía** en ámbar, **no realizada** con borde rojo y tachado diagonal, **en curso** relleno hasta la mitad, **pendiente** vacío. En la grilla de cumplimiento se estiran (hasta 56 px de ancho) y llevan el mismo código.

### Camino lineal (componente firma)

La ronda dibujada como una línea que serpentea en filas de hasta 10 puntos y solo dobla a 45° y 90°. Punto registrado: círculo lleno en tinta; próximo: círculo con aro; sin registro: contorno rojo con cruz; pendiente: hueco con línea punteada. Los puntos que están a la vista en la tabla se resaltan; tocar uno lo marca en la tabla y en el mapa. Reemplaza cualquier lista larga de 40 puntos por una vista de un golpe de ojo.

### Foja (detalle de ronda)

Encabezado con volver, título y sello de estado; metadatos en rótulo y valor; camino lineal; barra de acciones (filtros "Todos / Pendientes / Sin registro", Llamar, Simular lectura); y la tabla de puntos: N°, punto, prevista, registrada (sello) y estado. La tabla se desliza y arranca centrada en el punto actual, dos filas antes.

### Mapa

Base tenue en tonos del sistema; predios con contorno punteado; marcador de predio como sello rectangular con "hechos/total" y un tallo; puntos de la ruta como cuadrados (relleno al registrar, doble borde el próximo, rojo con cruz el faltante); la ruta, línea sólida si ya se recorrió y punteada si falta.

### Selector de vista

Control segmentado (igual que los chips) que cambia cómo se muestra el mismo dato: tabla, grilla o gráficos. Lleva un texto por botón (nunca solo ícono), `aria-pressed`, y recuerda la última vista elegida. Vive junto al filtro de período, arriba a la derecha de la hoja.

### Gráficos

Cuando una vista es un gráfico, sigue las mismas reglas que el resto del sistema: marcas en tinta (lo normal), ámbar para demoras y rojo con trama diagonal para fallas, de modo que se distingan sin color; ejes, rejilla y marcos en filete, sin degradados, sombras ni esquinas redondeadas; barras de borde recto; cifras tabulares y etiquetas en condensada; leyenda y valores escritos directamente sobre las marcas cuando entran; el tooltip es un recuadro de hoja con borde de 1,5 px. Una serie que no es excepción no usa color.

La torta se usa solo para partes de un todo con pocas categorías (hasta seis), nunca para series en el tiempo. Las porciones normales se distinguen por intensidad de tinta y las fallas llevan la trama roja; siempre va con su leyenda escrita y su tabla equivalente.

### Bloques y modo edición

Las pantallas de resumen se arman con bloques: hojas planas con título en condensada, la acción hacia la pantalla completa a la derecha y un cuerpo con desplazamiento propio que se adapta al tamaño del bloque. Los bloques viven en una grilla de 96 columnas y filas de 8 px, con 24 px de separación entre bloques: se ubican y miden casi al píxel. Mientras se arrastra, el bloque sigue al puntero y un marco punteado muestra dónde va a quedar; los demás se deslizan a su lugar (sin animación con movimiento reducido). El bloque queda donde se suelta; los que pisa bajan lo justo y ninguno sube, así los huecos los decide el usuario. Cada bloque tiene un mínimo por presentación y, si se achica, el texto se corta con "…" (completo al pasar el puntero) y las columnas secundarias de las tablas se ocultan antes que el nombre. En celular los bloques se apilan con su alto natural: se desplaza la página, no cada bloque.

El usuario puede editar el diseño desde 1024 px de ancho con **Editar diseño**. En edición:

- cada bloque lleva un marco punteado (todavía no está fijo), que se vuelve sólido mientras se mueve;
- aparecen dos asas cuadradas de 36 px con borde de 1,5 px en tinta, montadas sobre el marco para no tapar el contenido: mover, centrada sobre el borde superior, y cambiar el tamaño, sobre la esquina inferior derecha. Tomada, el asa se invierte (fondo tinta);
- el contenido del bloque queda inerte;
- la barra de acciones reemplaza a **Editar diseño**: Bloques, Deshacer, Restablecer diseño, Cancelar y Guardar diseño (principal). Nada se guarda hasta tocar Guardar; cancelar con cambios pide confirmación.

El panel **Bloques** es una hoja lateral con un grupo por bloque: interruptor de visibilidad y controles segmentados de presentación y ajustes.

### Menú de fila (⋮)

Las filas que se pueden fijar o reordenar llevan al final un botón ⋮ de 36 px. Un toque abre sus acciones (fijar, mover, quitar), que también son la alternativa al arrastre. Mantenerlo apretado 300 ms lo convierte en asa: la fila sigue al puntero y las demás le hacen lugar. Las filas fijadas van primero, con un ícono de alfiler, un fondo de hoja teñida y un filete más grueso debajo del grupo. Cada cambio deja un aviso en línea con Deshacer.

### Campos y diálogos

Campos con rótulo condensado encima, borde de 1,5 px en filete fuerte, radio de 3 px y alto de 40 px. Diálogos de 520 px con título en condensada y acciones a la derecha. Las opciones excluyentes (por ejemplo, "Interno" o "Visible al cliente") son bloques seleccionables con recuadro interior de 2 px.

### App del vigilador

- **Fila de punto:** número en condensada, casillero cuadrado (con tilde al registrar, tachado si falta) y sello de hora; la actual, enmarcada y más grande, con la ventana horaria debajo del nombre.
- **Aviso de envío:** recuadro punteado con el contador de registros por enviar.
- **Pánico:** anillo de mantener 1,5 segundos con progreso cónico en rojo.

### Motion

Principios: movimiento funcional, una vez por acción, sin rebote. Estados 120 ms lineales; apariciones de 200 a 250 ms con salida exponencial; el mapa se acerca a un predio en unos 520 ms con salida exponencial fuerte; la fila recién creada resalta y se desvanece en 1,6 s. Un solo momento con énfasis: al registrar un punto, el sello "cae" (90 ms, de 1,04 a 1, sin rebote) [pendiente: no está en la maqueta]. Con `prefers-reduced-motion`, todo cambia de estado al instante y el mapa salta sin animar.

## Do's and Don'ts

### Do:

- **Do** poner la hora en un sello junto a todo registro, y el estado de sincronización donde importe.
- **Do** mostrar lo normal en tinta y reservar el rojo y el ámbar para excepciones.
- **Do** acompañar cada estado con forma y texto (tilde, tachado, punteado, invertido).
- **Do** usar cifras tabulares en horas y contadores, y alinear columnas con grilla.
- **Do** usar el camino lineal y la tabla de puntos juntos para cualquier ronda larga.
- **Do** dejar que el usuario elija entre tabla, grilla y gráficos con un selector de vista, sin duplicar datos entre vistas.
- **Do** armar las pantallas de resumen con bloques que el usuario pueda acomodar, con un diseño por defecto que funcione sin tocar nada.
- **Do** dejar que cada pantalla ocupe todo el ancho y que el panel izquierdo y las columnas crezcan con la ventana.
- **Do** mantener 44 px mínimos de zona táctil en la app y 56 px en la acción principal.

### Don't:

- **Don't** usar el rojo de forma decorativa ni para algo que no sea una falla.
- **Don't** agregar sombras, degradados, vidrio ni esquinas de más de 4 px.
- **Don't** usar tarjetas iguales con ícono, título y texto como estructura de página.
- **Don't** mostrar números grandes sueltos como "métrica" de portada.
- **Don't** usar la condensada en mayúsculas para párrafos ni nombres de personas.
- **Don't** representar estados solo con color.
- **Don't** copiar la estética de Material 3 en Android: se imita su comportamiento, no su apariencia.
- **Don't** reintroducir el ámbar de señal del sistema anterior ni usar el verde para marcar "cumplido" en tablas, ventanas o el camino lineal.
- **Don't** exponer a un cliente la ubicación ni más datos del vigilador que los acordados.

## Plataformas

- **Android** sigue el comportamiento de Material 3 (barra inferior de cuatro destinos, gesto atrás predictivo, borde a borde con barras de sistema transparentes, zonas táctiles de 48 dp, tema del sistema) pero no su estética. **iOS** usa los equivalentes de la plataforma (insets seguros, deslizar desde el borde para volver, Reduce Motion, 44 pt).
- La app no usa librería de íconos: los pocos íconos (tilde, cruz, cerrar, flechas) son SVG propios dibujados con `react-native-svg`.
- Las fuentes (Public Sans y Barlow Condensed) se empaquetan con la app y el panel: no se cargan desde la red.

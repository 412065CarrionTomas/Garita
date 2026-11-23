# Recorrido ideal de la ronda

El mapa de supervisión ya no une los puntos de control con rectas que cruzan manzanas. Dibuja el **recorrido ideal**: el camino que el vigilador **debería** seguir, en el orden que armó el supervisor. No es el recorrido real del vigilador, porque la app no guarda el GPS de forma continua.

## Decisiones

- **El orden nunca se toca.** Se sigue el orden de puntos de la ronda. No hay reordenamiento automático ni sugerencia de orden óptimo.
- **Tramos y secciones.** Un tramo va de un punto de control al siguiente. Los **puntos de paso** no se escanean y dividen el tramo en **secciones**. Cada sección es:
  - **Por calles:** la calcula openrouteservice, y los puntos intermedios fuerzan por dónde pasa.
  - **A mano:** el supervisor marca los quiebres. Sirve para el interior de un parque industrial, donde OpenStreetMap no tiene caminos.
- **"Volver al inicio"** se elige por ronda y viene activado por defecto: agrega el tramo del último punto al primero.
- **El editor no mueve puntos de control.** Se mueven desde Puntos, porque su ubicación alimenta la detección de registros sospechosos (fuera de rango y tiempo imposible).
- **Se guarda por versión.** El recorrido vive en `RoundVersion.route` (JSONB). Cada guardado crea una versión nueva que aplica a los turnos futuros. El detalle de un turno usa el recorrido de su propia versión, no el de la actual. Con `route = null` (rondas previas) se dibuja recto.
- **La API calcula siempre la geometría.** Nunca se acepta la geometría que manda el navegador: el navegador manda modos, puntos de paso y quiebres (`routeInputSchema`) y la API devuelve el recorrido guardable (`roundRouteSchema`). Los contratos están en `packages/shared/src/rounds/route.ts`, con coordenadas `[longitud, latitud]`.
- **Si el ruteo falla, el supervisor decide.** Ver [Fallas](#fallas).

## Cálculo (API)

Módulo `apps/api/src/modules/routing/`:

- **`ROUTING_PORT`**: `route(profile, sections[][])` devuelve, para cada sección, la línea o el motivo de la falla.
- **`OpenRouteServiceRouting`**:
  - Pide `POST /v2/directions/{perfil}/geojson`.
  - Agrupa en un solo pedido las secciones encadenadas sin caché, hasta 50 puntos, y corta la línea por sección con `properties.way_points`.
  - Corta a los 5 s y valida la respuesta con Zod.
  - Registra los errores sin coordenadas.
- **Caché en Redis** (`RouteCache`): clave = hash del perfil y las coordenadas a 6 decimales, por 30 días. Las fallas no se guardan.
- **Sin `ORS_API_KEY`** se usa `NullRouting`: nada se calcula, con motivo `not_configured`. Los tests y el CI nunca llaman al servicio real.
- **Perfil según `Site.maxSpeedProfile`:** `walking` → `foot-walking`, `bicycle` → `cycling-regular`, `vehicle` y `custom` → `driving-car`.
- **`RouteBuilder`** arma el recorrido completo:
  - Todas las secciones por calles van en una sola llamada al puerto.
  - Las secciones a mano son la polilínea de inicio, quiebres y fin.
  - Se calcula antes de la transacción de guardado, nunca adentro.

## API

| Método y ruta                      | Entrada / respuesta                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /predios/:id/rondas`         | Ronda con `route` y `allowStraight` opcionales. Sin `route`, circuito por calles. `422` si alguna sección falla y no llegó `allowStraight`: no guarda nada |
| `PATCH /rondas/:id`                | Igual que el alta; crea una versión nueva                                                                                                                  |
| `POST /rondas/ruteo-previsualizar` | `{ siteId, checkpointIds, route }` → `{ route, failures }` con `200`, aunque haya fallas. No guarda nada                                                   |
| `GET /turnos/:id/detalle`          | Suma `routes: [{ roundId, roundName, checkpointIds, route }]`, de la misma versión que los puntos del turno                                                |

Admin y supervisor. El predio y los puntos tienen que ser de la empresa (`404` si no). Cualquier coordenada a más de 25 km del predio responde `400`.

## Fallas

Cada falla es `{ leg, section, reason }`:

| Motivo              | Cuándo                                                     | ¿Se sabe el tramo? |
| ------------------- | ---------------------------------------------------------- | ------------------ |
| `unreachable_point` | Error 2010 de ORS: un punto no está cerca de ninguna calle | Sí                 |
| `no_route`          | Error 2009 de ORS: no hay camino entre los puntos          | Sí                 |
| `skipped`           | La sección iba en el mismo pedido que una que falló        | —                  |
| `rate_limited`      | Respuesta 429 o 403 (límite por minuto o por día)          | No                 |
| `unavailable`       | Servicio caído, más de 5 s o respuesta inválida            | No                 |
| `not_configured`    | La API no tiene clave                                      | No                 |

El tramo culpable sale del índice que trae el mensaje de error de ORS ("coordinate N", "points N"). Si el formato no coincide, todo el pedido queda con el motivo general.

## Panel

- **Rondas → formulario → Recorrido** (`apps/web/src/features/rondas/route-editor-view.tsx`, cargado en diferido):
  - Mapa con los puntos numerados y lista de tramos.
  - Cada sección se pone "Por calles" o "A mano".
  - Puntos de paso y quiebres se agregan desde la lista (en la mitad del tramo, con teclado) o tocando el mapa con "Marcar en el mapa", y se arrastran.
  - "Calcular recorrido" muestra el camino o las fallas, y no modifica lo armado.
  - Si un punto se movió desde que se trazó un tramo, se avisa con "Recalcular".
- **Al guardar, si el ruteo falla**, un cartel explica la falla y lista los tramos, con "Reintentar", "Guardar con tramos rectos" (reenvía con `allowStraight`) y "Cerrar". El formulario queda como estaba.
- **Supervisión → detalle del turno:** se dibuja un recorrido por ronda, y cada tipo de sección se distingue por patrón:
  - Por calles: continua.
  - A mano: trazo largo.
  - Sin calcular: punteada, con aviso.

  Además:
  - Lo recorrido va ancho y en tinta; lo pendiente, fino y atenuado.
  - Lleva borde para leerse sobre la foto satelital y flechas de sentido.
  - Los puntos de paso son rombos sin número.

## Backfill

`pnpm --filter api db:backfill-routes` calcula por calles las rondas activas con `route = null` y lo guarda en su versión actual, sin crear versiones.

- Es idempotente.
- Espera 1,6 s entre rondas para respetar el límite por minuto.
- Al final informa cuántas salieron por calles y cuántas quedaron rectas.
- Exige `ORS_API_KEY`: sin clave todo quedaría recto y, como ya no sería `null`, no se volvería a calcular.

## Fuera de alcance

- Mostrarle el recorrido al vigilador en la app.
- El recorrido real del vigilador.
- Sugerir un orden óptimo.

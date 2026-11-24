# Recorrido ideal de la ronda

El mapa de supervisión ya no une los puntos de control con rectas que cruzan manzanas. Dibuja el **recorrido ideal**: el camino que el vigilador **debería** seguir, en el orden que armó el supervisor. No es el recorrido real del vigilador, porque la app no guarda el GPS de forma continua.

## Decisiones

- **El orden nunca se toca.** Se sigue el orden de puntos de la ronda. No hay reordenamiento automático ni sugerencia de orden óptimo.
- **Tramos y partes.** Un tramo va de un punto de control al siguiente. Los **cambios de modo** (`waypoints`) no se escanean y dividen el tramo en **partes** (`sections`). Cada parte es:
  - **Por calles:** la calcula openrouteservice, y sus **puntos de guía** (`via`) fuerzan por dónde pasa.
  - **Trazo libre:** rectas entre sus puntos de guía. Sirve para el interior de un parque industrial, donde OpenStreetMap no tiene caminos.
- **Un cambio de modo siempre cambia el modo.** Si dos partes vecinas quedan con el mismo modo, se unen y el corte pasa a punto de guía (mientras no superen los 48 puntos de guía). Los recorridos viejos con "puntos de paso" del mismo modo a los dos lados se abren así.
- **"Volver al inicio"** se elige por ronda y viene activado por defecto: agrega el tramo del último punto al primero.
- **El editor no mueve puntos de control.** Se mueven desde Puntos, porque su ubicación alimenta la detección de registros sospechosos (fuera de rango y tiempo imposible).
- **Se guarda por versión.** El recorrido vive en `RoundVersion.route` (JSONB). Cada guardado crea una versión nueva que aplica a los turnos futuros. El detalle de un turno usa el recorrido de su propia versión, no el de la actual. Con `route = null` (rondas previas) se dibuja recto.
- **La API calcula siempre la geometría.** Nunca se acepta la geometría que manda el navegador: el navegador manda modos, cambios de modo y puntos de guía (`routeInputSchema`) y la API devuelve el recorrido guardable (`roundRouteSchema`). Los contratos están en `packages/shared/src/rounds/route.ts`, con coordenadas `[longitud, latitud]`.
- **Si el ruteo falla, el supervisor decide.** Ver [Fallas](#fallas).

## Cálculo (API)

Módulo `apps/api/src/modules/routing/`:

- **`ROUTING_PORT`**: `route(profile, sections[][])` devuelve, para cada sección, la línea o el motivo de la falla.
- **`OpenRouteServiceRouting`**:
  - Pide `POST /v2/directions/{perfil}/geojson`.
  - Agrupa en un solo pedido las partes encadenadas sin caché, hasta 50 puntos, y corta la línea por parte con `properties.way_points`. La regla de agrupado (`chainSections`) está en `@garita/shared`: el panel la usa para estimar cuántos pedidos costará calcular.
  - Hace los pedidos de a uno, para no chocar con el límite por minuto.
  - Si los `way_points` vienen al revés o fuera de la línea, la parte queda `unavailable` (no se guarda como recta buena).
  - Corta a los 5 s y valida la respuesta con Zod.
  - Registra los errores sin coordenadas.
- **Caché en Redis** (`RouteCache`): clave = hash del perfil y las coordenadas a 6 decimales, por 30 días. Las fallas no se guardan. Si Redis no está, sigue sin caché enseguida (sin cola de comandos ni reintentos).
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
| `POST /rondas/ruteo-previsualizar` | `{ siteId, checkpointIds, route }` → `{ route, failures }` con `200`, aunque haya fallas. No guarda nada. Sin puntos repetidos y hasta 500 puntos          |
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

- **Rondas → editor** (`apps/web/src/features/rondas/`, mapa cargado en diferido). Pensado para mouse; las listas y la barra de abajo alcanzan sin mapa.
  - **Columna con pestañas Orden y Tramos.** Orden: los puntos de la ronda (se arrastran, se suben y bajan) y los de afuera. Tramos: cada tramo plegable con sus partes, su estado y sus puntos de guía numerados. Cada parte tiene «+» (punto de guía a 15 m del anterior) y la última del tramo, «+<ícono>» (el otro modo hasta el destino).
  - **Mapa:** tocar una línea elige su parte; sobre la parte elegida, un clic suma un punto de guía en ese lugar. Los puntos se arrastran y el clic derecho los elimina. Con «Sumar puntos de control» solo cuentan los pines.
  - **Barra de abajo:** muestra lo elegido. Una parte: modo (Por calles o Trazo libre), estado y contadores. Un punto de guía: «Cambiar de modo en este punto». Un cambio de modo: el mismo interruptor apagado lo vuelve punto de guía.
  - **Estados de una parte:** trazo libre (no se calcula), calculada, sin calcular, falló o guardada recta. Cada parte recuerda su línea por sus datos: editarla la deja sin calcular y lo demás conserva lo calculado.
  - **«Calcular por calles»** pide solo lo que cambió (y lo guardado recto), con «N partes sin calcular · hasta M pedidos». No se calcula nunca solo.
  - Si un punto se movió más de 5 m desde que se trazó, sus partes quedan sin calcular y se avisa hasta recalcularlas.
- **Al guardar, si el ruteo falla**, un aviso explica las fallas, con «Ver la parte con falla», «Guardar con esas partes rectas» (reenvía con `allowStraight`) y «Cerrar». El editor queda como estaba.
- **Supervisión y previsualizaciones:** cada tipo de parte se distingue por patrón (todo en tinta):
  - Por calles: continua.
  - Trazo libre: a rayas.
  - Sin calcular o falló: punteada y recta.

  Además:
  - Lo recorrido va ancho y en tinta; lo pendiente, fino y atenuado.
  - Lleva borde para leerse sobre la foto satelital y flechas de sentido.
  - Los cambios de modo son un rectángulo partido con el ícono de cada modo, y hay una leyenda plegable.

## Backfill

`pnpm --filter api db:backfill-routes` calcula por calles las rondas activas con `route = null` y lo guarda en su versión actual, sin crear versiones.

- Es idempotente.
- Espera 1,6 s entre rondas para respetar el límite por minuto; si igual llega al límite, espera un minuto.
- Ante fallas pasajeras (límite, servicio caído) no guarda la ronda: la próxima pasada la reintenta.
- Al final informa cuántas salieron por calles, cuántas quedaron rectas y cuántas quedan para reintentar.
- Exige `ORS_API_KEY`: sin clave todo quedaría recto y, como ya no sería `null`, no se volvería a calcular.

## Fuera de alcance

- Mostrarle el recorrido al vigilador en la app.
- El recorrido real del vigilador.
- Sugerir un orden óptimo.

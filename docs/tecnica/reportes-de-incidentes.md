# Incidentes y tiempos de respuesta — HU-26

El módulo `reports` agrega consultas de lectura; no modifica incidentes, avisos ni pánicos. Reutiliza el alcance y los logs de HU-25 mediante `ReportScopeService`. Las funciones puras `computeIncidentReport`, `computeResponseTimes`, `summarizeResponseTimes`, `firstResponse` y `computePanicReport` están en `packages/shared/src/reports/incidents.ts` y se importan desde `@garita/shared` y devuelven datos independientes de HTTP para HU-40.

## Período y fórmulas

Fechas locales de `Company.timezone`, intervalo **[desde, hasta)**. Ambos extremos juntos, inicio anterior al fin y máximo doce meses calendario; reutiliza la validación de HU-25. Por defecto, último mes hasta el inicio del día actual.

| Indicador                                           | Fecha que selecciona el período         | Cálculo                                                                                 |
| --------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Incidentes por tipo, predio, clasificación y franja | `trustedAt ?? occurredAtDevice`         | Conteos; doce franjas locales de dos horas, 00–02 hasta 22–24                           |
| Pendientes del período                              | Ocurrencia del incidente                | Clasificación actual `pending`; antigüedad desde `receivedAt`, mínimo de los pendientes |
| Respuesta al pánico                                 | `triggeredAt`                           | `confirmedAt - triggeredAt`; no desde recepción                                         |
| Respuesta a ronda incumplida                        | `Notice.createdAt`, tipo `round_missed` | Primer `NoticeView.seenAt` de un supervisor menos creación del aviso                    |
| Clasificación de incidentes                         | `Incident.receivedAt`                   | Primera `IncidentClassification.decidedAt` menos recepción, aunque haya reclasificación |
| Pánico por resultado/canal                          | `triggeredAt`                           | `real_emergency`, `false_alarm`, `test` y sin resolver; `internet`/`sms`                |

Los tiempos se devuelven en milisegundos; la pantalla muestra minutos. Promedio aritmético y máximo solo de respuestas existentes; sin respuesta se cuenta aparte y un conjunto vacío devuelve `null`. Diferencias negativas se limitan a cero para no mostrar duraciones imposibles. Escaladas cuenta `escalatedAt != null`, incluso sin confirmar. Ejemplo CA2: envío 03:10, recepción 03:25, confirmación 03:27 → **17 minutos**. La proporción de falsas alarmas divide falsas alarmas por todas las alertas seleccionadas, incluidas las no resueltas; sin alertas devuelve `null`.

La atribución usa quien confirmó el pánico, quien vio primero el aviso y quien tomó la primera decisión. Los totales por predio incluyen todas las respuestas de esos predios. Para desempates se ordena por fecha y clave estable. Las decisiones y primeras lecturas se seleccionan en la base, una por evento, sin consultas individuales por fila.

## Endpoints y permisos

Prefijo `/api/v1`, roles `admin` y `supervisor`; `guard` y `client` reciben 403, sin sesión 401. Empresa desde autenticación y consultas con `tenantPrisma`. Un predio/cliente ajeno o no asignado da 404 mediante `TenantResourceService`.

- `GET /reportes/incidentes?desde=&hasta=&predio=&cliente=`: agrupaciones, pendientes y filtros visibles.
- `GET /reportes/incidentes/detalle`: mismos filtros más `tipo`, `franja` (hora inicial par de 0 a 22), `clasificacion`, `page` y `pageSize` (1–100, 25 por defecto).
- `GET /reportes/tiempos-de-respuesta`: totales, `bySite` y visibilidad de personas según rol.
- `GET /reportes/panico`: resultado, canal y proporción de falsas alarmas.
- `GET /reportes/panico/detalle`: mismos filtros más `resultado` (`unresolved` para sin resolver), `canal`, `page` y `pageSize`.

Todos admiten período, predio y cliente. El administrador recibe `bySupervisor`; el supervisor recibe **solo `own`**, sin clave `bySupervisor`. La eliminación se hace en la API, no en el panel. Las respuestas no incluyen coordenadas, teléfonos, fotos ni comentarios. Swagger documenta parámetros y esquemas Zod.

Cada consulta registra `reports.query`: tipo, usuario, rol, predios, período y `elapsedMs`; `warn` si supera diez segundos, incluso si falla. Los detalles usan `count`, `skip` y `take` en Prisma. El segmento de franja se convierte en intervalos UTC por día local antes de paginar, preservando el uso de hora confiable y el filtro tenant.

## Índices y rendimiento

La migración `indices_de_reportes_de_incidentes` agrega solo índices: `Incident(companyId, trustedAt)`, `(companyId, occurredAtDevice)`, `(companyId, receivedAt)`, `PanicAlert(companyId, triggeredAt)` y `Notice(companyId, kind, createdAt)`. Los índices anteriores por creación no cubrían las fechas de estas consultas; el de aviso con `status` entre tipo y fecha no cubría el rango sin estado. `IncidentClassification(companyId, incidentId, decidedAt)` y la clave de `NoticeView(noticeId, userId)` ya sirven para las relaciones; no se duplican.

El e2e crea con `createMany` 50 predios y 31 días con cuatro incidentes y cuatro alertas por día/predio (6.200 de cada uno), y exige menos de tres segundos por endpoint principal. Es una medición local/CI, no una garantía para cualquier volumen. Las agrupaciones cargan solo campos usados; no hay precálculo ni caché que pueda desactualizar una clasificación.

## Panel y accesibilidad

Ruta `/incidentes-y-respuesta`, menú de administrador y supervisor junto a Cumplimiento. Una sola barra de filtros (período Hoy/7 días/30 días/Fechas, predio y cliente) se aplica al cambiar y vive en la URL; el botón activo se deduce de las fechas consultadas. Con un período inválido no se consulta y se deshabilita el PDF. Arriba, cifras contra el período anterior de igual duración (`previous` / `previousTotals`): incidentes, gravedad alta, seguimiento abierto (total real, `openFollowUpsTotal`), tiempo de clasificación, respuesta a pánico y falsas alarmas (diferencia en puntos porcentuales). Luego el mapa de calor día × franja de 2 h (`byWeekdayTimeBand`, tabla accesible con celdas-botón), barras `CountBars` con el número a la vista por tipo, predio, gravedad, resultado y canal de pánico, la tabla de seguimiento abierto y los tiempos en una sola `DataTable` por predio o supervisor. Rondas incumplidas se informa en Cumplimiento. Cada barra o celda abre el detalle en un panel lateral (`Sheet`) con `DataTable` y `Pagination`; `GET /reportes/incidentes/detalle` acepta además `dia` (0 = lunes), `gravedad` y `seguimiento`. Las pruebas RTL cubren tablas y teclado; contraste real, lector de pantalla y render de ambos temas requieren prueba manual.

# Cumplimiento de rondas — HU-25

El módulo `reports` consulta estados vigentes; no recalcula ventanas ni persiste totales. `computeCompliance`, en `@garita/shared`, es la única fórmula para el panel y para los futuros consumidores del portal y PDF. `REPORT_RECALCULATION_PORT` sigue siendo noop.

## Fórmula

`completas / evaluadas × 100`, con `evaluadas = completas + incompletas + no realizadas`. Si no hay evaluadas devuelve `null`, que se muestra como «Sin datos».

| Estado                           | Tratamiento                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `complete`                       | Completa; separa sin observaciones, medias, leves y graves ya validadas                        |
| `complete_late`                  | Completa con demora, contada una sola vez                                                      |
| `incomplete`, `not_done`         | Evaluadas; no realizada incluye ausencia, falta de cobertura, cierre sin datos y sin vigilador |
| `in_review`, `pending_sync`      | Contadores separados, fuera del porcentaje                                                     |
| `pending`, `in_progress`, `late` | Fuera de evaluación: siguen en curso                                                           |
| Turno `cancelled`                | Se omiten todas sus ventanas                                                                   |

HU-17 y HU-39 producen los estados. Validar una ventana en revisión la devuelve a `complete`; invalidar un registro puede dejarla incompleta o no realizada. Cada GET lee nuevamente esos datos. CA1 da 18/20 = 90 % y dos en revisión; al validar una, 19/21 y una en revisión. Las observaciones no restan cumplimiento de una ventana completa.

## Atribución y fechas

`complianceOwner` llama a `windowOwner(endsAt, assignments)`: la asignación vigente al terminar es dueña de la ventana, aunque haya quedado ausente. Una ventana que termina exactamente al inicio del reemplazo sigue en la anterior; una asignación `replaced` no rigió. Sin dueño o sin guardia, se agrupa como «Sin vigilador», con ID nulo: cuenta en el predio y no se adjudica a una persona. Usuarios no activos se indican como desactivados, sin borrar su historia.

`desde` y `hasta` son fechas `YYYY-MM-DD` de `Company.timezone`; intervalo **[desde, hasta)**, con fin excluido. Para octubre: `desde=2026-10-01&hasta=2026-11-01`. Se convierten a medianoches locales mediante `localDateTimeToUtc`. La evolución usa el inicio local de la ventana, incluso al cruzar medianoche. Máximo doce meses calendario, inicio anterior al fin; ambos extremos se envían juntos. Por defecto, un mes calendario hasta el inicio de hoy, ajustando el día al último existente del mes anterior.

## API y permisos

Swagger en `/api/docs` documenta parámetros y respuestas Zod compartidas. Prefijo `/api/v1`:

- `GET /reportes/rondas?desde=&hasta=&predio=&cliente=&vigilador=`: totales, evolución, comparación por predio y por guardia, y opciones visibles de filtros. `vigilador=unassigned` selecciona sin vigilador.
- `GET /reportes/rondas/detalle`: mismos filtros más `estado`, `dia` local, `page` (desde 1) y `pageSize` (1–100, por defecto 25). Incluye IDs de turno para `/supervision/turnos/:id`.
- `GET /reportes/pendientes?predio=`: conteos y mínimo de `inReviewSince`, creación del incidente pendiente, creación del aviso abierto `shift_unsynced`, y próximo inicio de turno futuro `unassigned`. Son pendientes actuales, independientes del período, cliente y vigilador.
- `GET /reportes/puntos-marcas-frecuentes?desde=&hasta=&predio=`: diez puntos ordenados por proporción descendente, con mínimo tres registros marcados. No aplica cliente ni vigilador; la pantalla explicita este alcance.

Administrador: toda la empresa. Supervisor: solo predios asignados, también al omitir filtros. `TenantResourceService` valida IDs de predio, cliente y vigilador; `tenantPrisma` agrega aislamiento de empresa y predios en todas las lecturas. Un predio o cliente ajeno/no asignado responde 404; guardia y cliente 403; sin sesión 401. Nunca se usa SQL sin aislamiento ni `systemPrisma` en el módulo.

Los puntos cuentan registros con `invalidatedAt = null`, según `occurredAtDevice`. Varias marcas en un registro cuentan una sola vez. La atribución usa la asignación del registro. Si un vigilador concentra al menos 70 % de los registros marcados, se informa «concentradas»; en otro caso se informa «repartidas», con cantidad de vigiladores distintos. No es una sanción ni una prueba de conducta.

## Índices y rendimiento

La migración `indices_de_reportes` agrega `RoundWindowState(companyId, startsAt)` y `(companyId, status, startsAt)`, `CheckpointRecord(companyId, occurredAtDevice)` y `(companyId, checkpointId, occurredAtDevice)`, `RecordFlag(companyId, createdAt)` y `Notice(companyId, kind, status, createdAt)`. Conserva los índices por predio/turno existentes y reutiliza `Incident(companyId, classificationStatus, createdAt)`, ya presente; no duplica índices.

Cada consulta emite `reports.query` con usuario, rol, IDs de predios, período y `elapsedMs`, con nivel warn al superar diez segundos. No registra ubicación ni registros individuales. El e2e crea 50 predios × 31 días × 12 ventanas (18.600) con `createMany` y exige GET mensual menor a tres segundos.

La consulta carga las ventanas y asignaciones necesarias y agrupa en memoria. El detalle se pagina después de resolver la atribución histórica. Si las mediciones reales requieren escalar, primero mover selección de segmentos/paginación al repositorio conservando exactamente `windowOwner`; luego considerar totales diarios por empresa, fecha local, predio y asignación. Cualquier precálculo deberá invalidarse transaccionalmente por cambios de estado/revisión y ofrecer recomputación verificable. No se implementa sin evidencia de necesidad, porque los totales actuales siempre deben reflejar la última decisión.

## Interfaz reutilizable

`features/reportes/charts/ComplianceChart` recibe filas y callbacks, sin API ni dependencia de la pantalla interna. Usa Recharts, tokens semánticos de ambos temas y tablas equivalentes visibles con botones nativos para cada segmento. Las animaciones están deshabilitadas. El SVG es complementario; el lector de pantalla usa las tablas, sin duplicación del anuncio. El detalle conserva los filtros activos al seleccionar predio, día, estado o vigilador.

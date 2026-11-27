# Portal del cliente — HU-28

El portal tiene consultas propias en `PortalService` y respuestas Zod estrictas en `packages/shared/src/portal.ts`. Selecciona campos permitidos desde Prisma y arma objetos nuevos: no devuelve reportes internos depurados. `ClientIncidentsReader` se reemplazó por este servicio; la descripción del vigilador no forma parte de la HU y no se devuelve.

## Endpoints y permisos

Prefijo `/api/v1`; Swagger en `/api/docs`, sección **Portal del cliente**. Todos los endpoints exigen Firebase y `@Roles('client')`: sin sesión 401; administrador, supervisor y vigilador 403. Sin `clientId` o con cliente inactivo, 403. El cliente siempre sale del usuario autenticado; no se acepta `cliente` como parámetro.

| GET                                                         | Respuesta permitida                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/portal/predios`                                           | Lista de `id`, `name` de predios activos del cliente activo                                                            |
| `/portal/rondas?desde=&hasta=&predio=`                      | Período, zona, cantidades por estado del cliente, evaluadas, porcentaje, evolución diaria y aclaración de verificación |
| `/portal/rondas/dia?fecha=&predio=&page=&pageSize=`         | Horarios de inicio/fin, predio y estado visible; total y paginación                                                    |
| `/portal/incidentes?desde=&hasta=&predio=&page=&pageSize=`  | ID, tipo, ocurrencia, predio, última nota al cliente y cantidad de fotos                                               |
| `/portal/incidentes/:id/fotos`                              | Miniatura y archivo completo como enlaces privados firmados                                                            |
| `/portal/emergencias?desde=&hasta=&predio=&page=&pageSize=` | Activación, predio y milisegundos hasta confirmación; total y paginación                                               |

`predio` ajeno, inexistente o inactivo responde el mismo 404. La política central `addClientFilter` conserva empresa y exige cliente/predio activos en `RoundWindowState`, `Incident` y `PanicAlert`; incidentes solo `client_visible`, pánicos solo `resolved` y `real_emergency`. La consulta de fotos vuelve a comprobar visibilidad al cargar las fotos. El portal usa `tenantPrisma`, sin bypass de sistema. `TenantResourceService` conserva su verificación interna de pertenencia y su 404 genérico.

## Fechas, fórmula y traducción

`desde` y `hasta` se envían juntos en formato `YYYY-MM-DD`, período local **[desde, hasta)** de hasta doce meses calendario, igual que HU-25. Por defecto se usa `defaultReportPeriod`: un mes calendario hasta el inicio de hoy en la zona de la empresa. `fecha` es el día local del inicio de la ventana. Las fechas inválidas, parámetros extra o paginación inválida responden 400. Listas de 25 elementos, máximo 100 por página.

`computePortalCompliance` llama a la única fórmula `computeCompliance` de HU-25: completas/evaluadas × 100; sin evaluadas, `null`. La traducción única `portalRoundStatus` tiene estos resultados:

| Estado interno                                   | Estado del cliente                      |
| ------------------------------------------------ | --------------------------------------- |
| `complete`, incluidas observaciones              | `completa`                              |
| `complete_late`                                  | `completa`                              |
| `incomplete`                                     | `incompleta`                            |
| `not_done`                                       | `no_realizada`                          |
| `in_review`                                      | `en_verificacion`, fuera del porcentaje |
| `pending_sync`, `pending`, `in_progress`, `late` | No se muestra                           |
| Turno cancelado                                  | No se consulta ninguna ventana          |

Las rondas en verificación se muestran aparte con **El porcentaje se actualiza cuando la empresa termina de verificarlas**. No se almacenan totales: cada consulta lee los estados vigentes y refleja la revisión siguiente. Una no realizada cuenta en el cumplimiento, pero nunca se informa si su causa fue una ausencia o falta de cobertura.

Los incidentes usan `trustedAt`, con respaldo en `occurredAtDevice`; el filtro y la fecha visible usan la misma ocurrencia. La nota se toma de la última clasificación, ordenada por `decidedAt` e ID. Las emergencias exigen confirmación y calculan `confirmedAt − triggeredAt` sin revelar quién confirmó ni el comentario de resolución.

## Datos internos excluidos

| Dato interno                                     | Por qué no viaja                                                |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Nombres e IDs de vigiladores                     | Identidad del personal, ajena al contrato del portal            |
| IDs de turno, asignaciones y reasignaciones      | Organización interna del servicio                               |
| Ausencias y turnos sin vigilador                 | Solo corresponde el estado de cumplimiento, no la causa interna |
| Marcas, gravedad y revisión                      | Evidencia operativa para la empresa                             |
| Comentarios internos y descripción del vigilador | Solo la última nota publicada está autorizada para el cliente   |
| Incidentes pendientes o internos                 | Falta autorización expresa de publicación                       |
| Falsas alarmas, pruebas y pánicos sin resolver   | No son emergencias reales resueltas                             |
| Marca de demora                                  | La HU requiere mostrarla como completa                          |
| Rondas sin sincronizar o en curso                | Aún no tienen evaluación publicable                             |
| Ubicación, autor y comentario del pánico         | Información sensible innecesaria para el cliente                |

## Fotos, auditoría y rendimiento

Se reutiliza `PHOTO_STORAGE_PORT` exportado por incidentes: Cloudinary autenticado y URL de descarga firmada por **cinco minutos**, sin enlace público permanente. La lista no firma fotos; se piden al abrirlas. La web renueva las URLs cada cuatro minutos mientras están visibles y reconsulta al volver a abrir. Respuestas HTTP `Cache-Control: private, no-store`. Firebase, notificaciones y almacenamiento están mockeados en los tests.

Cada consulta registra `portal.query`, usuario y cliente por ID, predios, período y `elapsedMs`; a partir de tres segundos, nivel warn. No registra nombres, notas, ubicaciones ni URLs firmadas. Se reutilizan los índices existentes: no hay migración ni dependencia nueva. El agregado mensual no carga marcas ni historial de asignaciones; el e2e mide diez predios adicionales × 31 días × doce ventanas. El detalle carga solo un día y pagina las filas visibles después de aplicar la traducción compartida.

`PortalService` se exporta desde `PortalModule`: HU-40 puede llamar a los mismos métodos de datos, con usuario autenticado y contexto tenant, sin duplicar permisos. El mensaje de cuenta suspendida se integra en HU-43; PDF en HU-40.

## Verificación

- `packages/shared/src/portal.spec.ts`: traducción, 18/20 = 90%, verificación aparte, vacío y período.
- `apps/api/src/modules/prisma/tenant-prisma.spec.ts`: políticas y conservación de filtros/empresa/clave.
- `apps/api/test/app.e2e-spec.ts`: los seis endpoints sin sesión y con roles internos.
- `apps/api/test/portal.e2e-spec.ts`: CA1–CA6, tres clientes en dos empresas, visibilidad activa, fotos, revisión por HTTP, no exposición y tiempo mensual.
- `apps/web/src/features/portal/portal-page.test.tsx`: filtros, teclado, tablas equivalentes, verificación, listas, fotos, errores y vacíos.

La prueba visual real a 360 px, ambos temas y lector de pantalla queda en la checklist manual del PR. Los tests con DOM simulado no acreditan esa verificación.

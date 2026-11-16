# Exportación de reportes a PDF — HU-40

## Uso por rol

Administrador y supervisor: abrir **Cumplimiento** o **Incidentes y respuesta**,
aplicar los filtros y pulsar **Exportar a PDF**. El supervisor conserva el alcance
de sus predios; la comparación de tiempos por supervisor solo se exporta para el
administrador. El cumplimiento conserva la comparación por vigilador y los puntos
con marcas frecuentes. Estos últimos usan período y predio, sin aplicar cliente ni
vigilador, igual que la pantalla; el PDF lo indica en el título.

Cliente: abrir **Reportes de mis predios**, consultar el período y predio y pulsar
**Exportar a PDF**. Incluye cumplimiento, evolución, rondas (también en verificación),
incidentes compartidos y emergencias reales resueltas. Cada incidente indica la
cantidad de fotos y que se consultan en el portal; no incluye archivos de imágenes.
Nunca usa reportes internos depurados para construir este documento.

El botón funciona con Tab y Enter o espacio; anuncia **Generando el PDF…** y el
resultado mediante una región viva. Durante la generación impide repetir la
descarga. Un error permite reintentar. Usa el botón del sistema de diseño, que
hereda tema claro/oscuro, foco y contraste.

El período máximo es de tres meses calendario, con el fin excluido de las
pantallas: desde 01/08 hasta 01/11 incluye agosto, septiembre y octubre. Desde
01/08 hasta 02/11 se rechaza con **El período máximo para exportar es de 3 meses**.
Los fines de mes se ajustan al último día válido (30/11 a 28/02, o 29/02 en año
bisiesto). Si el botón conoce un período inválido, avisa sin llamar a la API.

## API

Prefijo `/api/v1`; documentación binaria en Swagger, sección **Exportación PDF**.

| GET                        | Roles             | Filtros                                  |
| -------------------------- | ----------------- | ---------------------------------------- |
| `/reportes/rondas/pdf`     | admin, supervisor | desde, hasta, predio, cliente, vigilador |
| `/reportes/incidentes/pdf` | admin, supervisor | desde, hasta, predio, cliente            |
| `/portal/reporte/pdf`      | client            | desde, hasta, predio                     |

Fechas opcionales en pares, validadas con los esquemas de la pantalla; por defecto
se usa su último mes. El límite adicional de exportación está centralizado en
`isReportExportPeriodAllowed`. No se admiten filtros extra. Sin token responde 401;
un rol no autorizado, 403; un recurso ajeno/no asignado, 404.

Las respuestas llevan `application/pdf`, `Content-Disposition: attachment` con un
nombre legible y período, y `Cache-Control: private, no-store`. La descarga web usa
`apiDownload` con token Firebase en la cabecera y un blob local; no expone tokens en
URLs. La API arma el archivo en memoria y no guarda el PDF.

## Generación y aislamiento

Se eligió PDFKit 0.20.2, ya instalado, con barras y líneas vectoriales y texto
nativo seleccionable. La [investigación aprobada](../spikes/hu-40-pdf.md) documenta
fuentes, decisión, métricas y alcance de la PoC. Cada gráfico lleva una tabla
equivalente. El eje horizontal sigue el orden de las filas de esa tabla; los
valores ausentes se indican como **Sin datos** y cortan las líneas.

El encabezado contiene nombres de empresa, clientes y predios autorizados, período
y generación en la zona de la empresa. Título y pie se repiten por página; los
encabezados de tabla y su título se repiten al continuar. Las celdas largas se
dividen en líneas y páginas sin descartar contenido. El documento declara título,
autor Garita e idioma `es`. No se declara conformidad PDF/UA.

`ReportExportsService` usa el mismo `AuthenticatedUser` y las respuestas de
`ReportsService`, `IncidentReportsService` y `PortalService`. Recorre sus listados
paginados completos, hasta 100 filas por llamada. El portal se valida nuevamente
con sus esquemas Zod estrictos, sin fotos ni asignaciones, marcas, notas internas o
identidades de vigiladores. No se consulta ninguna tabla de datos de reporte por
fuera de esos servicios.

Excepción aprobada para el encabezado: lectura mínima con `tenantPrisma` de
`Company.name` y, para cliente, solo `Client.name` de `user.clientId`; para personal,
predios ya autorizados por el reporte y su `client.name`. El resultado se valida
con `reportExportHeaderSchema`, estricto y solo con nombres. La política central
agrega `Client` propio activo y `ReportExport` propio para el cliente; el resto
permanece denegado por defecto. **Este cambio de política requiere revisión en el
PR.** No se incorpora `systemPrisma` ni SQL crudo a la exportación.

## Registro y métricas

Una migración `registro_de_exportaciones` crea `ReportExport`: empresa, usuario,
rol, IDs de predios, fechas locales de inicio/fin, tipo (`rounds`, `incidents`,
`portal`), resultado (`ok`, `failed`), correlación y fecha de generación. No hay
endpoint de consulta. El modelo está registrado en `COMPANY_ID_MODELS`.

Cada solicitud que alcanza el servicio se registra, incluso por período rechazado,
404 o error de generación. Si falla antes de resolver el alcance se guarda el
predio solicitado, o una lista vacía cuando se pidió todos; los filtros inválidos
no se copian como texto libre. Las solicitudes denegadas por el guard (401/403) no
tienen una exportación iniciada ni usuario validado en este servicio.

Se emite `event: report_export.metric` a nivel log para éxito y error para fallo,
con correlación, tipo, resultado, usuario/rol, IDs de predios, período, bytes,
duración y RSS. No se registran contenido del PDF, fotos ni ubicaciones. Si no puede
persistirse el registro, no se entrega la descarga y se emite la métrica fallida;
una caída de base impide garantizar una fila persistida.

Los datos se leen en varias consultas y pueden cambiar durante la generación; no
se conserva una instantánea transaccional de los servicios. El pie lo advierte:
**Generado por Garita el [fecha y hora]. Los datos pueden cambiar por verificaciones
posteriores.**

## Verificación y rendimiento

La suite `report-exports.e2e-spec.ts` siembra 92 días, 92 turnos, 1104 ventanas,
92 incidentes visibles y 92 emergencias reales. Mide las tres descargas HTTP con
los servicios reales, renderizado, registro y extracción de texto, exigiendo menos
de 15 s y 5.000.000 bytes para cada PDF. Emite `HU40_PERF` con duración, peso y
memoria; las cifras finales se registran en el reporte de W7 y el PR. No mide el
plan de hosting ni concurrencia. No se recorta contenido para cumplir el límite.

Los tests generan sin compresión (`NODE_ENV=test`) y leen operadores de texto con
`test/pdf-text.ts`, limitado a Helvetica estándar y streams sin comprimir. El
helper no es un parser general; no requiere Python ni dependencias en CI. La
compresión se mantiene en producción. Los casos de permisos también están en
`app.e2e-spec.ts` y los de límite en `packages/shared/src/reports/export.spec.ts`.

Para reproducir, apuntar `DATABASE_URL` a `garita_s3_w7_test` sin modificar `.env`,
aplicar migraciones y seed, y ejecutar `pnpm --filter api test:e2e`. La corrida
final del worker incluye lint, typecheck, test, format:check y e2e en serie.

## Checklist manual pendiente

- [ ] Abrir los tres PDF en un lector y seleccionar/copiar texto con tildes.
- [ ] Confirmar empresa, clientes, predios, período, zona y fecha de generación.
- [ ] Revisar gráficos, tablas, columnas, continuación de tablas y pie en cada página.
- [ ] Administrador: comparación por vigilador y puntos con marcas frecuentes.
- [ ] Supervisor: solo predios asignados; comparación por supervisor ausente.
- [ ] Cliente: verificación, incidentes compartidos, emergencias reales y cantidad de fotos; sin datos internos ni imágenes.
- [ ] Botón en claro/oscuro y pantalla angosta, con Tab, Enter y espacio.
- [ ] Lector de pantalla: anuncia generación, éxito, límite y fallo/reintento.
- [ ] Seis meses no llama a la API desde el botón; API responde 400 si se solicita directamente.
- [ ] Repetir medición en el hosting elegido con datos y concurrencia representativos.

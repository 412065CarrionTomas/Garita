# HU-40 / ID-318 — generación de PDF con gráficos

Estado: aprobada por el coordinador el 2026-11-16 (respuesta a `msg_c27b6ac03681`).

## Decisión propuesta

Usar PDFKit 0.20.2, ya instalado, con gráficos vectoriales simples (barras y
líneas) y tabla equivalente por gráfico. Reusar el patrón de
`CheckpointsService.createStickerPdf`: documento A4, eventos `data`, `end` y
`error`, y `Buffer.concat`. No agregar dependencias ni ejecutar Chromium.

El grafo de `b5fdbbdd` conecta PDFKit con `createStickerPdf`, y los controladores
con `ReportsService`, `IncidentReportsService` y `PortalService`. Se verificaron
esas relaciones contra el código de esta misma base. El renderizador recibirá
respuestas de esos servicios con el usuario autenticado; no consultará datos de
reporte por Prisma. El portal se validará con sus esquemas estrictos.

## Comparación

| Aspecto       | PDFKit con vectores                                      | Navegador sin interfaz                                             |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Dependencias  | Ninguna nueva; PDFKit 0.20.2 instalado                   | Motor y automatización adicionales; no están en el lockfile        |
| Memoria       | Un proceso Node; cifras de la PoC abajo                  | Incluye proceso de navegador; no medido ni instalado               |
| Tiempo y peso | Medidos para un gráfico y su tabla de 92 días            | No medidos; no se presume un resultado                             |
| Texto         | Operadores de texto PDF; extracción comprobable          | `Page.pdf()` imprime el documento HTML                             |
| Hosting chico | Evita un segundo motor y sus binarios; validar en Render | Requiere comprobar binarios, sandbox, arranque y memoria del plan  |
| Fidelidad     | Mismos datos y tablas; dibujo propio de barras/líneas    | Puede imprimir HTML, pero necesita estilos de impresión y paginado |

La elección se apoya en el patrón ya instalado y en la PoC, no en una comparación
numérica inventada con Chromium. Los gráficos actuales de cumplimiento usan barras
y líneas rectas; PDFKit cubre esas primitivas. No se promete una copia visual exacta
del SVG de Recharts ni se rasteriza texto.

## Prueba de concepto reproducible

Ejecutar desde la raíz, sin instalar paquetes, sin servicios externos y sin base.
El bloque JavaScript siguiente se ejecuta por stdin en el contexto de `apps/api`.
Usa datos sintéticos diarios de agosto a octubre (92 días), no datos personales.
El tiempo incluye cargar PDFKit, crear los datos, dibujar y reunir el PDF en memoria.
La memoria informa RSS antes/después y máximo del proceso Node, no memoria de Render.

````powershell
$spikeDoc = Get-Content -Raw docs/spikes/hu-40-pdf.md
$spikeSource = [regex]::Match($spikeDoc, '(?s)```javascript\r?\n(.*?)\r?\n```').Groups[1].Value
$spikeResult = $spikeSource | pnpm --silent --filter api exec node
$spikeResult | ConvertFrom-Json | Select-Object -ExpandProperty metrics
````

```javascript
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const startedAt = performance.now();
const before = process.memoryUsage();
const PDFDocument = require('pdfkit');
const rows = Array.from({ length: 92 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10),
  complete: 480 + (index % 61),
  evaluated: 600,
}));
const generatedAt = '16/11/2026, 12:00 (America/Argentina/Buenos_Aires)';
const footer = `Generado por Garita el ${generatedAt}. Los datos pueden cambiar por verificaciones posteriores.`;
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 45, right: 45, bottom: 75, left: 45 },
  compress: false,
  lang: 'es',
  info: { Title: 'Cumplimiento de rondas — PoC HU-40', Author: 'Garita' },
});
const chunks = [];
const finished = new Promise((resolve, reject) => {
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});
let pages = 0;
function pageHeader() {
  pages++;
  doc.font('Helvetica').fontSize(6).text(footer, 45, 785, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(16).text('Cumplimiento de rondas', 45, 45);
  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Empresa de ejemplo / Cliente de ejemplo / Depósito Ruta 9');
  doc.text('Desde 2026-08-01 hasta 2026-11-01 (fin excluido)');
  doc.text(`Generado: ${generatedAt}`);
}
doc.on('pageAdded', pageHeader);
pageHeader();
const complete = rows.reduce((sum, row) => sum + row.complete, 0);
doc.text(`${complete} completas de 55200 evaluadas (${((complete / 55200) * 100).toFixed(2)} %).`);
doc.font('Helvetica-Bold').text('Evolución diaria del cumplimiento', 45, 145);
doc.font('Helvetica').fontSize(8).text('100 %', 45, 175).text('0 %', 45, 285);
doc.moveTo(80, 180).lineTo(80, 300).lineTo(545, 300).stroke();
rows.forEach((row, index) => {
  const x = 80 + (index * 465) / (rows.length - 1);
  const y = 300 - (row.complete / row.evaluated) * 120;
  if (index === 0) doc.moveTo(x, y);
  else doc.lineTo(x, y);
});
doc.stroke();
doc.text(rows[0].day, 80, 307).text(rows.at(-1).day, 490, 307);
let y = 345;
function tableHeader() {
  doc.font('Helvetica-Bold').fontSize(10);
  ['Día', 'Completas', 'Evaluadas', 'Cumplimiento'].forEach((value, index) => {
    doc.text(value, 45 + index * 125, y, { width: 120 });
  });
  doc.font('Helvetica');
  y += 22;
}
tableHeader();
for (const row of rows) {
  if (y + 20 > 750) {
    doc.addPage();
    y = 145;
    tableHeader();
  }
  [
    row.day,
    String(row.complete),
    String(row.evaluated),
    `${((row.complete / row.evaluated) * 100).toFixed(2)} %`,
  ].forEach((value, index) => {
    doc.text(value, 45 + index * 125, y, { width: 120 });
  });
  y += 20;
}
doc.end();
finished
  .then((pdf) => {
    const elapsedMs = performance.now() - startedAt;
    const raw = pdf.toString('latin1');
    // shortcut: solo Helvetica estándar y streams sin comprimir; usar un lector real para fuentes embebidas.
    const text = [...raw.matchAll(/<([0-9a-f]+)>/gi)]
      .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
      .join('');
    assert(raw.startsWith('%PDF-'));
    assert(raw.includes('/Lang (es)'));
    assert(text.includes('Cumplimiento de rondas'));
    assert(text.includes('2026-08-01') && text.includes('2026-10-31'));
    assert.equal(
      text.split('Los datos pueden cambiar por verificaciones posteriores.').length - 1,
      pages,
    );
    assert.equal(text.split('Evaluadas').length - 1, pages);
    assert(elapsedMs < 15000);
    assert(pdf.length < 5000000);
    const after = process.memoryUsage();
    process.stdout.write(
      JSON.stringify({
        metrics: {
          node: process.version,
          platform: process.platform,
          days: rows.length,
          pages,
          elapsedMs: Number(elapsedMs.toFixed(2)),
          bytes: pdf.length,
          rssBeforeMiB: before.rss / 1048576,
          rssAfterMiB: after.rss / 1048576,
          peakRssMiB: process.resourceUsage().maxRSS / 1024,
          heapDeltaMiB: (after.heapUsed - before.heapUsed) / 1048576,
          compression: false,
        },
        pdfBase64: pdf.toString('base64'),
      }),
    );
  })
  .catch((error) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
```

El `pdfBase64` permite examinar el documento sin persistirlo. No se añade un parser
al proyecto: el chequeo mínimo decodifica los operadores hexadecimales de texto de
Helvetica en la PoC sin compresión. La comprobación final de contenido por rol debe
ejercitar el generador definitivo, no sustituirse por esta PoC.

## Resultados y límites

Ejecución local del 2026-11-16, Node v24.19.0 / Windows, proceso nuevo, sin
compresión (un caso conservador para el peso de este mismo contenido):

| Medida                            | Resultado                                               |
| --------------------------------- | ------------------------------------------------------- |
| Período sintético                 | 2026-08-01 a 2026-11-01, fin excluido: 92 filas diarias |
| Páginas                           | 4                                                       |
| Tiempo incluyendo carga de PDFKit | 200,40 ms                                               |
| Peso                              | 41.809 bytes                                            |
| RSS antes / después               | 46,97 / 67,25 MiB                                       |
| Máximo RSS del proceso            | 68,61 MiB                                               |
| Incremento de heap usado          | 8,58 MiB                                                |

Pasaron los asserts incluidos: firma PDF, idioma, título, primera y última fecha,
pie y encabezado de tabla una vez por página, menos de 15 s y 5 MB.
Adicionalmente se extrajo texto con `pdfplumber 0.11.10`, ya instalado en el
equipo, sin instalarlo ni añadirlo como dependencia. Se comprobaron las cuatro
páginas (984, 1142, 1142 y 764 caracteres extraídos), el último día, el pie y
encabezado en cada una, y ausencia de imágenes. El último carácter del pie termina
en x=405,53 puntos, dentro del ancho A4. La extracción demuestra contenido textual;
la selección manual en un lector queda en la checklist final.

Durante la PoC se detectó que poner `width` al pie, fuera del margen inferior,
activa el paginado y causa recursión en `pageAdded`. Se corrigió usando una línea
sin ancho de ajuste; los asserts por página y el lector verifican ese caso.

La medición no prueba CA3 completo: faltan consultas de servicios, listados reales,
concurrencia y ejecución en el plan de Render. No se recortará contenido para cumplir
el límite; si tres meses lo exceden se consultará al coordinador.

## Puerta de decisión y siguiente alcance

El coordinador aprobó PDFKit sin dependencias nuevas y confirmó el límite con fin
excluido: agosto a octubre se pide como `2026-08-01` a `2026-11-01`, permitido.
`hasta` puede ser igual a `desde + 3 meses calendario`, ajustado al último día
válido; se rechazan fechas posteriores. Esta aclaración reemplaza el ejemplo
incompatible de la spec. La suite usa un helper propio de extracción de cadenas
de texto sin compresión, sin Python ni dependencias nuevas.

También autorizó, en respuestas a `msg_5d800edfd849` y `msg_31265c9b5625`, leer
metadatos mínimos del encabezado en el módulo nuevo y ampliar únicamente las dos
ramas de la política cliente: `Client` propio activo y `ReportExport` del usuario
autenticado, conservando el aislamiento por empresa. No se modifican los servicios
de reportes o del portal ni se usa `systemPrisma` en la exportación.

Tras resolver la consulta, dividir en cambios atómicos: contrato compartido y
tests del período; modelo y migración `registro_de_exportaciones` con aislamiento;
módulo API con renderizado, registro y pruebas HTTP por rol; botón compartido y
montaje en las tres pantallas con tests; documentación y reporte. Las suites
generales se ejecutarán una sola vez al final según la spec, no durante el spike.

## Fuentes oficiales consultadas

- [PDFKit: streams, metadatos y páginas](https://pdfkit.org/docs/getting_started.html).
- [PDFKit: primitivas vectoriales](https://pdfkit.org/docs/vector.html).
- [PDFKit: texto y medidas](https://pdfkit.org/docs/text.html).
- [Puppeteer: generación con navegador y Page.pdf](https://pptr.dev/guides/pdf-generation).

Se conserva el import compatible del repo: la documentación actual recomienda el
export nombrado, pero conserva el export por defecto. Las APIs usadas se contrastan
con PDFKit 0.20.2 instalado y `@types/pdfkit` del proyecto.

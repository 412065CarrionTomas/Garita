import { renderReportPdf } from './report-pdf';
import { pdfPageTexts } from '../../../test/pdf-text';

it('conserva texto, encabezados y pies al paginar filas largas sin rasterizar', async () => {
  const pdf = await renderReportPdf({
    title: 'Reporte de cumplimiento',
    header: { company: 'Empresa Norte', clients: ['Cliente propio'], sites: ['Depósito Ruta 9'] },
    desde: '2026-08-01',
    hasta: '2026-11-01',
    timezone: 'America/Argentina/Buenos_Aires',
    generatedAt: new Date('2026-11-16T15:00:00Z'),
    sections: [
      {
        title: 'Listado extenso',
        columns: ['Predio', 'Contenido'],
        rows: [
          ['Depósito Ruta 9', 'Nota '.repeat(1500) + 'FIN_NOTA_LARGA'],
          ...Array.from({ length: 100 }, (_, index) => ['Predio propio', `FILA_${index}`]),
        ],
      },
    ],
  });
  const pages = pdfPageTexts(pdf);
  expect(pages.length).toBeGreaterThan(3);
  for (const page of pages) {
    expect(page).toContain('Reporte de cumplimiento');
    expect(page).toContain('Generado por Garita el 16/11/26, 12:00:00');
    expect(page).toContain('Los datos pueden cambiar por verificaciones posteriores.');
  }
  const text = pages.join('\n');
  expect(text).toContain('FIN_NOTA_LARGA');
  expect(text).toContain('FILA_99');
  expect(text.match(/Contenido/g)).toHaveLength(pages.length);
  expect(pdf.toString('latin1')).toContain('/Lang (es)');
  expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
});

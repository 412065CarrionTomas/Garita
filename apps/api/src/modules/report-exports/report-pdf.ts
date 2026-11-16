import PDFDocument from 'pdfkit';
import type { ReportExportHeader } from '@garita/shared';

export interface PdfSection {
  title: string;
  columns: string[];
  rows: string[][];
  chart?: { values: (number | null)[]; line?: boolean; percentage?: boolean };
}
export interface ReportPdf {
  title: string;
  header: ReportExportHeader;
  desde: string;
  hasta: string;
  timezone: string;
  generatedAt: Date;
  sections: PdfSection[];
}

/** Dibujos y texto nativos; nunca rasteriza ni carga recursos externos. */
export function renderReportPdf(report: ReportPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, right: 40, bottom: 75, left: 40 },
    compress: process.env.NODE_ENV !== 'test',
    lang: 'es',
    info: { Title: report.title, Author: 'Garita', CreationDate: report.generatedAt },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });
  const width = doc.page.width - 80;
  const bottom = 750;
  const generated = new Intl.DateTimeFormat('es-AR', {
    timeZone: report.timezone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(report.generatedAt);
  let y = 75;
  let page = 0;
  const pageHeader = () => {
    page++;
    doc.font('Helvetica').fontSize(7);
    // Sin width: el pie fuera del margen no debe activar otro pageAdded.
    doc.text(`Generado por Garita el ${generated} (${report.timezone}).`, 40, 780, {
      lineBreak: false,
    });
    doc.text('Los datos pueden cambiar por verificaciones posteriores.', 40, 791, {
      lineBreak: false,
    });
    doc.text(`Página ${page}`, 485, 791, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).text(report.title, 40, 40, { width });
    y = Math.max(75, doc.y + 12);
  };
  doc.on('pageAdded', pageHeader);
  pageHeader();
  function nextPage() {
    doc.addPage();
  }
  function title(text: string) {
    doc.font('Helvetica-Bold').fontSize(11);
    const height = doc.heightOfString(text, { width });
    if (y + height + 45 > bottom) nextPage();
    doc.text(text, 40, y, { width });
    y += height + 10;
  }
  function wrap(text: string, cellWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (line && doc.widthOfString(line + char) > cellWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function table(section: PdfSection) {
    const cellWidth = width / section.columns.length;
    const heading = () => {
      doc.font('Helvetica-Bold').fontSize(8);
      const lines = section.columns.map((cell) => wrap(cell, cellWidth - 12));
      const height = Math.max(...lines.map((cell) => cell.length)) * 11 + 10;
      doc.rect(40, y, width, height).fill('#eeeeee');
      doc.fillColor('black');
      lines.forEach((cell, index) => {
        cell.forEach((line, lineIndex) => {
          doc.text(line, 46 + index * cellWidth, y + 5 + lineIndex * 11, { lineBreak: false });
        });
      });
      y += height;
    };
    const continued = () => {
      nextPage();
      title(`${section.title} (continuación)`);
      heading();
    };
    heading();
    const rows = section.rows.length
      ? section.rows
      : [section.columns.map((_, index) => (index ? '' : 'Sin datos'))];
    for (const row of rows) {
      doc.font('Helvetica').fontSize(8);
      const lines = row.map((cell) => wrap(cell, cellWidth - 12));
      const count = Math.max(...lines.map((cell) => cell.length));
      if (y + Math.min(count * 11 + 8, 300) > bottom) continued();
      let offset = 0;
      while (offset < count) {
        const fits = Math.floor((bottom - y - 8) / 11);
        if (fits < 1) {
          continued();
          continue;
        }
        const take = Math.min(fits, count - offset);
        doc.font('Helvetica').fontSize(8);
        lines.forEach((cell, index) => {
          cell.slice(offset, offset + take).forEach((line, lineIndex) => {
            doc.text(line, 46 + index * cellWidth, y + 4 + lineIndex * 11, { lineBreak: false });
          });
        });
        y += take * 11 + 8;
        doc
          .moveTo(40, y)
          .lineTo(40 + width, y)
          .lineWidth(0.25)
          .stroke();
        offset += take;
        if (offset < count) continued();
      }
    }
    y += 16;
  }
  function chart(section: PdfSection) {
    const data = section.chart;
    if (!data?.values.length) return;
    if (y + 170 > bottom) {
      nextPage();
      title(section.title);
    }
    const top = y + 15;
    const left = 75;
    const chartWidth = width - 45;
    const max = data.percentage ? 100 : Math.max(1, ...data.values.map((value) => value ?? 0));
    doc.font('Helvetica').fontSize(8).text(String(max), 40, top, { lineBreak: false });
    doc.text('0', 40, top + 100, { lineBreak: false });
    doc
      .moveTo(left, top)
      .lineTo(left, top + 110)
      .lineTo(left + chartWidth, top + 110)
      .stroke();
    const step = chartWidth / data.values.length;
    let connected = false;
    for (const [index, value] of data.values.entries()) {
      if (value === null) {
        if (connected) doc.stroke();
        connected = false;
        continue;
      }
      const x = left + (index + 0.5) * step;
      const valueY = top + 110 - (value / max) * 100;
      if (data.line) {
        if (connected) doc.lineTo(x, valueY);
        else doc.moveTo(x, valueY);
        connected = true;
      } else
        doc
          .rect(left + index * step + step * 0.1, valueY, step * 0.8, top + 110 - valueY)
          .fill('black');
    }
    if (connected) doc.stroke();
    doc.text('Orden de filas de la tabla; valores nulos: Sin datos.', left, top + 118, {
      lineBreak: false,
    });
    y = top + 145;
  }
  try {
    table({
      title: 'Encabezado',
      columns: ['Dato', 'Valor'],
      rows: [
        ['Empresa', report.header.company],
        ['Cliente(s)', report.header.clients.join(', ') || 'Sin clientes'],
        ['Predio(s)', report.header.sites.join(', ') || 'Sin predios'],
        ['Período', `${report.desde} a ${report.hasta} (fin excluido)`],
        ['Generación', `${generated} (${report.timezone})`],
      ],
    });
    for (const section of report.sections) {
      title(section.title);
      chart(section);
      if (y + 55 > bottom) {
        nextPage();
        title(section.title);
      }
      table(section);
    }
    doc.end();
  } catch (error) {
    doc.destroy(error instanceof Error ? error : new Error('No se pudo generar el PDF'));
  }
  return finished;
}

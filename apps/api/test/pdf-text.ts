/** Solo para los PDF de tests: Helvetica estándar y streams sin compresión. */
export function pdfPageTexts(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  if (!raw.startsWith('%PDF-') || raw.includes('/FlateDecode'))
    throw new Error('El helper requiere un PDF válido sin compresión');
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((stream) =>
      [...(stream[1] ?? '').matchAll(/\[([^\]]*)\]\s*TJ/g)]
        .map((operator) =>
          [...(operator[1] ?? '').matchAll(/<([0-9a-f]+)>/gi)]
            .map((part) => Buffer.from(part[1] ?? '', 'hex').toString('latin1'))
            .join(''),
        )
        .join('\n'),
    )
    .filter(Boolean);
}

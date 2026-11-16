import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiDownload } from '@/lib/api-client';
import { ExportPdfButton } from './export-pdf-button';

jest.mock('@/lib/api-client', () => ({ apiDownload: jest.fn() }));
const filters = { desde: '2026-08-01', hasta: '2026-11-01', predio: 'predio-1' };
const createObjectURL = jest.fn(() => 'blob:pdf-local');
const revokeObjectURL = jest.fn();
beforeEach(() => {
  jest.mocked(apiDownload).mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});
afterEach(() => jest.restoreAllMocks());

it('descarga con los filtros vigentes al activar con teclado y anuncia la generación', async () => {
  const user = userEvent.setup();
  let complete: (blob: Blob) => void = () => {
    throw new Error('Descarga no iniciada');
  };
  jest.mocked(apiDownload).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  render(<ExportPdfButton endpoint="/reportes/rondas/pdf" filters={filters} />);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Exportar a PDF' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('status')).toHaveTextContent('Generando el PDF…');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(apiDownload).toHaveBeenCalledWith(
    '/reportes/rondas/pdf?desde=2026-08-01&hasta=2026-11-01&predio=predio-1',
  );
  complete(new Blob(['pdf'], { type: 'application/pdf' }));
  await waitFor(() => {
    expect(screen.getByRole('status')).toHaveTextContent('El PDF está listo');
  });
  expect(click).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf-local');
  expect(screen.getByRole('button')).toBeEnabled();
});
it('rechaza seis meses antes de llamar a la API', async () => {
  render(
    <ExportPdfButton
      endpoint="/portal/reporte/pdf"
      filters={{ ...filters, desde: '2026-05-01' }}
    />,
  );
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'El período máximo para exportar es de 3 meses',
  );
  expect(apiDownload).not.toHaveBeenCalled();
});
it('informa el error y permite reintentar sin crear enlaces', async () => {
  jest.mocked(apiDownload).mockRejectedValue(new Error('offline'));
  render(<ExportPdfButton endpoint="/reportes/incidentes/pdf" filters={filters} />);
  await userEvent.click(screen.getByRole('button'));
  expect(await screen.findByText(/No pudimos generar el PDF/)).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeEnabled();
  expect(createObjectURL).not.toHaveBeenCalled();
});

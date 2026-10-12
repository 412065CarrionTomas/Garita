import { fireEvent, render, screen } from '@testing-library/react';
import { SiteLocation } from './site-location';

describe('SiteLocation sin clave de Google Maps', () => {
  it('permite cargar las coordenadas manualmente y valida rangos del navegador', () => {
    const onChange = jest.fn();
    render(<SiteLocation latitude={-34} longitude={-58} onChange={onChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ingresá las coordenadas manualmente');
    const latitude = screen.getByLabelText('Latitud');
    expect(latitude).toHaveAttribute('min', '-90');
    expect(latitude).toHaveAttribute('max', '90');
    fireEvent.change(latitude, { target: { value: '-35' } });
    expect(onChange).toHaveBeenCalledWith(-35, -58);
  });
});

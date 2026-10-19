import { fireEvent, render, screen } from '@testing-library/react';
import { SiteLocation } from './site-location';

describe('SiteLocation sin clave de Google Maps', () => {
  it('asocia las etiquetas a su campo cuando hay varias ubicaciones montadas', () => {
    render(
      <>
        <SiteLocation latitude={-34} longitude={-58} onChange={jest.fn()} />
        <SiteLocation latitude={-35} longitude={-59} onChange={jest.fn()} />
      </>,
    );
    const latitudes = screen.getAllByLabelText('Latitud');
    const longitudes = screen.getAllByLabelText('Longitud');
    expect(latitudes).toHaveLength(2);
    expect(longitudes).toHaveLength(2);
    expect(latitudes[0]).not.toHaveAttribute('id', latitudes[1]?.id);
    expect(longitudes[0]).not.toHaveAttribute('id', longitudes[1]?.id);
  });

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

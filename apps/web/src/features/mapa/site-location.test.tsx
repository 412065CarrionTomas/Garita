import { fireEvent, render, screen } from '@testing-library/react';
import { ManualLocation } from './site-location';

describe('carga manual de coordenadas', () => {
  it('asocia las etiquetas a su campo cuando hay varias ubicaciones montadas', () => {
    render(
      <>
        <ManualLocation latitude={-34} longitude={-58} onChange={jest.fn()} />
        <ManualLocation latitude={-35} longitude={-59} onChange={jest.fn()} />
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
    render(<ManualLocation latitude={-34} longitude={-58} onChange={onChange} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No se pudo cargar el mapa. Ingresá las coordenadas manualmente.',
    );
    const latitude = screen.getByLabelText('Latitud');
    expect(latitude).toHaveAttribute('min', '-90');
    expect(latitude).toHaveAttribute('max', '90');
    fireEvent.change(latitude, { target: { value: '-35' } });
    expect(onChange).toHaveBeenCalledWith(-35, -58);
  });
});

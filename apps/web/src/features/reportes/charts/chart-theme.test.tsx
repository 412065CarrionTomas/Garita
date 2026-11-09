import { render, screen } from '@testing-library/react';

import {
  ChartTooltip,
  FailurePattern,
  FAILURE_PATTERN_ID,
  axisProps,
  chartColors,
  gridProps,
} from './chart-theme';

it('toma los colores de variables CSS y la rejilla no tiene líneas verticales', () => {
  expect(chartColors.ink).toBe('var(--foreground)');
  expect(chartColors.failure).toBe('var(--danger)');
  expect(gridProps.vertical).toBe(false);
  expect(axisProps.tick.fontFamily).toBe('var(--font-cond)');
});

it('FailurePattern define la trama diagonal', () => {
  const { container } = render(
    <svg>
      <defs>
        <FailurePattern />
      </defs>
    </svg>,
  );
  expect(container.querySelector(`pattern#${FAILURE_PATTERN_ID}`)).toBeInTheDocument();
});

it('ChartTooltip muestra rótulo y valores solo si está activo', () => {
  const { rerender, container } = render(<ChartTooltip active={false} />);
  expect(container).toBeEmptyDOMElement();
  rerender(
    <ChartTooltip active label="Lunes" payload={[{ name: 'Cumplimiento', value: '92%' }]} />,
  );
  expect(screen.getByText('Lunes')).toBeInTheDocument();
  expect(screen.getByText('92%')).toBeInTheDocument();
});

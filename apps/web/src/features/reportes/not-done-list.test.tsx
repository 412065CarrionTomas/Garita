import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { NotDoneList } from './not-done-list';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));

it('requests the eight most recent windows from the whole period', async () => {
  jest.mocked(apiGet).mockResolvedValue({ items: [], total: 105, page: 1, pageSize: 8 });
  renderWithQueryClient(
    <MemoryRouter>
      <NotDoneList query="desde=2026-10-01&hasta=2026-11-01" timezone="UTC" />
    </MemoryRouter>,
  );
  await screen.findByText('Sin ventanas no realizadas');
  const path = jest.mocked(apiGet).mock.calls[0]?.[0] ?? '';
  const params = new URL(path, 'https://test.local').searchParams;
  expect(params.get('orden')).toBe('desc');
  expect(params.get('pageSize')).toBe('8');
});

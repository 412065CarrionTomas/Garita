import { fireEvent, render } from '@testing-library/react-native';
import { triggerPanic } from './actions';
import { PanicOverlay } from './panic-overlay';

jest.mock('./actions', () => ({ triggerPanic: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./transport', () => ({
  resumePanicAlerts: jest.fn().mockResolvedValue(undefined),
  fetchPanicState: jest.fn(),
}));
jest.mock('@/lib/db/database', () => ({
  createDefaultFieldRepository: jest.fn(async () => ({ listPanicAlerts: async () => [] })),
}));

describe('panic button', () => {
  beforeEach(() => jest.mocked(triggerPanic).mockClear());
  it('requires the long press, exposes the two-second gesture and screen-reader action', async () => {
    const rendered = await render(<PanicOverlay />);
    const button = rendered.getByLabelText('Pánico, mantener presionado');
    expect(button).toBeTruthy();
    fireEvent.press(button);
    expect(triggerPanic).not.toHaveBeenCalled();
    fireEvent(button, 'longPress');
    expect(triggerPanic).toHaveBeenCalledTimes(1);
  });
});

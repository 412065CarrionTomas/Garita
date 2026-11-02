import { panicGesture } from './gesture';

describe('locked panic gesture', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
  });
  afterEach(() => jest.useRealTimers());
  it('arms without sending, confirms at 4.9 s and rearms at 5.1 s', () => {
    const armed = panicGesture('panic', Date.now(), 0);
    expect(armed).toEqual({ fire: false, armedUntil: 15000 });
    jest.advanceTimersByTime(4900);
    expect(panicGesture('confirm', Date.now(), armed.armedUntil)).toEqual({
      fire: true,
      armedUntil: 0,
    });
    jest.advanceTimersByTime(200);
    expect(panicGesture('confirm', Date.now(), armed.armedUntil)).toEqual({
      fire: false,
      armedUntil: 20100,
    });
  });
  it('expires at exactly five seconds without sending', () => {
    const armed = panicGesture('panic', Date.now(), 0);
    jest.advanceTimersByTime(5000);
    expect(panicGesture('timeout', Date.now(), armed.armedUntil)).toEqual({
      fire: false,
      armedUntil: 0,
    });
    expect(panicGesture('confirm', Date.now(), armed.armedUntil).fire).toBe(false);
  });
});

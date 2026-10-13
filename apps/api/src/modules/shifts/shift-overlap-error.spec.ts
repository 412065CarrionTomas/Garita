import { isShiftOverlapViolation, SHIFT_OVERLAP_CONSTRAINT } from './shift-overlap-error';

describe('isShiftOverlapViolation', () => {
  it('detects the exclusion constraint by name in the message', () => {
    expect(
      isShiftOverlapViolation(
        new Error(`violates exclusion constraint "${SHIFT_OVERLAP_CONSTRAINT}"`),
      ),
    ).toBe(true);
  });

  it('detects the exclusion SQLSTATE carried in the error metadata', () => {
    const error = Object.assign(new Error('Raw query failed'), {
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    });
    expect(isShiftOverlapViolation(error)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(
      isShiftOverlapViolation(new Error('Unique constraint failed on the fields: (`id`)')),
    ).toBe(false);
    expect(isShiftOverlapViolation('not an error')).toBe(false);
  });
});

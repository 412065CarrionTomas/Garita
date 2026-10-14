import { SYNC_MAX_BACKOFF_SECONDS } from '@garita/shared';
import { computeSyncBackoff } from './backoff';

describe('computeSyncBackoff (CA11)', () => {
  it('returns base seconds for initial attempt 0', () => {
    expect(computeSyncBackoff(0)).toBe(5);
  });

  it('grows exponentially with subsequent attempts', () => {
    expect(computeSyncBackoff(1)).toBe(10);
    expect(computeSyncBackoff(2)).toBe(20);
    expect(computeSyncBackoff(3)).toBe(40);
    expect(computeSyncBackoff(4)).toBe(80);
    expect(computeSyncBackoff(5)).toBe(160);
  });

  it('caps at SYNC_MAX_BACKOFF_SECONDS (300 seconds / 5 minutes)', () => {
    expect(computeSyncBackoff(6)).toBe(SYNC_MAX_BACKOFF_SECONDS);
    expect(computeSyncBackoff(7)).toBe(300);
    expect(computeSyncBackoff(20)).toBe(300);
  });

  it('has no limit on number of attempts (keeps returning capped max)', () => {
    expect(computeSyncBackoff(50)).toBe(SYNC_MAX_BACKOFF_SECONDS);
    expect(computeSyncBackoff(100)).toBe(SYNC_MAX_BACKOFF_SECONDS);
    expect(computeSyncBackoff(1000)).toBe(SYNC_MAX_BACKOFF_SECONDS);
  });

  it('handles negative or decimal attempt inputs safely', () => {
    expect(computeSyncBackoff(-1)).toBe(5);
    expect(computeSyncBackoff(2.7)).toBe(20);
  });

  it('allows custom base and max seconds', () => {
    expect(computeSyncBackoff(0, 10, 60)).toBe(10);
    expect(computeSyncBackoff(1, 10, 60)).toBe(20);
    expect(computeSyncBackoff(2, 10, 60)).toBe(40);
    expect(computeSyncBackoff(3, 10, 60)).toBe(60);
    expect(computeSyncBackoff(10, 10, 60)).toBe(60);
  });
});

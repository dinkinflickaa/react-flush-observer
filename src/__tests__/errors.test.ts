import { InfiniteLoopError } from '../errors';
import type { LoopReport } from '../types';

describe('InfiniteLoopError', () => {
  const makeReport = (overrides: Partial<LoopReport> = {}): LoopReport => ({
    type: 'infinite-loop',
    pattern: 'infinite-loop-sync',
    commitCount: 50,
    windowMs: null,
    stack: null,
    suspects: [],
    triggeringCommit: null,
    forcedCommit: {
      withPassiveEffects: [],
      withLayoutEffects: [],
      withSuspense: [],
      withUpdates: [],
    },
    userFrame: null,
    timestamp: Date.now(),
    ...overrides,
  });

  test('is an instance of Error', () => {
    const err = new InfiniteLoopError(makeReport());
    expect(err).toBeInstanceOf(Error);
  });

  test('has name InfiniteLoopError', () => {
    const err = new InfiniteLoopError(makeReport());
    expect(err.name).toBe('InfiniteLoopError');
  });

  test('message includes commit count and pattern', () => {
    const err = new InfiniteLoopError(
      makeReport({ commitCount: 53, pattern: 'infinite-loop-async' })
    );
    expect(err.message).toContain('53');
    expect(err.message).toContain('infinite-loop-async');
  });

  test('exposes report on the error object', () => {
    const report = makeReport({ stack: 'trace' });
    const err = new InfiniteLoopError(report);
    expect(err.report).toBe(report);
  });

  test('has a stack trace', () => {
    const err = new InfiniteLoopError(makeReport());
    expect(typeof err.stack).toBe('string');
    expect(err.stack!.length).toBeGreaterThan(0);
  });
});

const { InfiniteLoopError } = require('../errors');

describe('InfiniteLoopError', () => {
  test('is an instance of Error', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(err).toBeInstanceOf(Error);
  });

  test('has name InfiniteLoopError', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(err.name).toBe('InfiniteLoopError');
  });

  test('message includes commit count and pattern', () => {
    const report = { commitCount: 53, pattern: 'infinite-loop-async' };
    const err = new InfiniteLoopError(report);
    expect(err.message).toContain('53');
    expect(err.message).toContain('infinite-loop-async');
  });

  test('exposes report on the error object', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync', stack: 'trace' };
    const err = new InfiniteLoopError(report);
    expect(err.report).toBe(report);
  });

  test('has a stack trace', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(typeof err.stack).toBe('string');
    expect(err.stack.length).toBeGreaterThan(0);
  });
});

class InfiniteLoopError extends Error {
  constructor(report) {
    super(
      `React infinite loop detected: ${report.commitCount} commits ` +
      `in one task (pattern: ${report.pattern})`
    );
    this.name = 'InfiniteLoopError';
    this.report = report;
  }
}

module.exports = { InfiniteLoopError };

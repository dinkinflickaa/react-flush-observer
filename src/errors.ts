import type { LoopReport } from './types';

export class InfiniteLoopError extends Error {
  readonly report: LoopReport;

  constructor(report: LoopReport) {
    super(
      `Infinite loop detected: ${report.pattern} (${report.commitCount} commits)`
    );
    this.name = 'InfiniteLoopError';
    this.report = report;
  }
}

import type { SourceInfo } from './types';

const INTERNAL_PATTERNS = [
  'node_modules',
  'react-dom',
  'scheduler',
  'react-flush-observer',
  '<anonymous>',
];

const FRAME_REGEX = /at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/;

export function parseUserFrame(stack: string | null): SourceInfo | null {
  if (!stack) {
    return null;
  }

  const lines = stack.split('\n');

  for (const line of lines) {
    const match = FRAME_REGEX.exec(line);
    if (!match) {
      continue;
    }

    const fileName = match[1];
    const isInternal = INTERNAL_PATTERNS.some((pattern) =>
      fileName.includes(pattern)
    );

    if (!isInternal) {
      return {
        fileName,
        lineNumber: parseInt(match[2], 10),
        columnNumber: parseInt(match[3], 10),
      };
    }
  }

  return null;
}

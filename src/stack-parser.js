// Matches V8-style stack frames: "    at Name (file:line:col)" or "    at file:line:col"
const framePattern = /at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/;

// Frames containing any of these substrings are internal (not user code)
const internalPatterns = [
  'node_modules',
  'react-flush-observer',
  'react-dom',
  'react-reconciler',
  'scheduler',
  'react.development',
];

function isInternalFrame(frameLine) {
  const lower = frameLine.toLowerCase();
  for (let i = 0; i < internalPatterns.length; i++) {
    if (lower.includes(internalPatterns[i])) return true;
  }
  return false;
}

function parseUserFrame(stack) {
  if (!stack) return null;

  const lines = stack.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('at ')) continue;
    if (isInternalFrame(line)) continue;

    const match = framePattern.exec(line);
    if (match) {
      return {
        fileName: match[1],
        lineNumber: parseInt(match[2], 10),
        columnNumber: parseInt(match[3], 10),
      };
    }
  }

  return null;
}

module.exports = { parseUserFrame };

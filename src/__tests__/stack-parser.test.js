const { parseUserFrame } = require('../stack-parser');

describe('parseUserFrame', () => {
  test('extracts first user-code frame from a V8 stack string', () => {
    const stack = [
      'Error: [flush-observer]',
      '    at handleCommit (http://localhost:5173/node_modules/.vite/deps/react-flush-observer.js:132:43)',
      '    at onCommitFiberRoot (http://localhost:5173/node_modules/.vite/deps/react-flush-observer.js:180:21)',
      '    at onCommitRoot (http://localhost:5173/node_modules/.vite/deps/react-dom.js:4182:29)',
      '    at commitRootImpl (http://localhost:5173/node_modules/.vite/deps/react-dom.js:19439:10)',
      '    at scheduleUpdateOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom.js:18615:14)',
      '    at dispatchSetState (http://localhost:5173/node_modules/.vite/deps/react-dom.js:12450:14)',
      '    at Object.handleClick (http://localhost:5173/src/MyComponent.jsx:9:6)',
    ].join('\n');

    const frame = parseUserFrame(stack);
    expect(frame).toEqual({
      fileName: 'http://localhost:5173/src/MyComponent.jsx',
      lineNumber: 9,
      columnNumber: 6,
    });
  });

  test('skips frames from node_modules', () => {
    const stack = [
      'Error',
      '    at Object.handleCommit (/app/node_modules/react-flush-observer/src/detector.js:30:10)',
      '    at Object.onCommitFiberRoot (/app/node_modules/react-dom/cjs/react-dom.development.js:100:5)',
      '    at onClick (/app/src/Button.tsx:12:4)',
    ].join('\n');

    const frame = parseUserFrame(stack);
    expect(frame).toEqual({
      fileName: '/app/src/Button.tsx',
      lineNumber: 12,
      columnNumber: 4,
    });
  });

  test('skips frames from react-flush-observer even outside node_modules', () => {
    const stack = [
      'Error',
      '    at handleCommit (react-flush-observer.js:30:10)',
      '    at dispatchSetState (react-dom.js:12450:14)',
      '    at setCount (webpack:///src/App.tsx:22:8)',
    ].join('\n');

    const frame = parseUserFrame(stack);
    expect(frame).toEqual({
      fileName: 'webpack:///src/App.tsx',
      lineNumber: 22,
      columnNumber: 8,
    });
  });

  test('returns null when no user frame found', () => {
    const stack = [
      'Error',
      '    at handleCommit (react-flush-observer.js:30:10)',
      '    at onCommitRoot (node_modules/react-dom/index.js:100:5)',
    ].join('\n');

    expect(parseUserFrame(stack)).toBeNull();
  });

  test('returns null for undefined or empty stack', () => {
    expect(parseUserFrame(undefined)).toBeNull();
    expect(parseUserFrame('')).toBeNull();
  });

  test('handles anonymous frames with file location', () => {
    const stack = [
      'Error',
      '    at Object.onCommitFiberRoot (react-flush-observer.js:180:21)',
      '    at scheduleUpdateOnFiber (react-dom.js:18615:14)',
      '    at <anonymous> (SetStateOutsideTest.jsx:9:6)',
    ].join('\n');

    const frame = parseUserFrame(stack);
    expect(frame).toEqual({
      fileName: 'SetStateOutsideTest.jsx',
      lineNumber: 9,
      columnNumber: 6,
    });
  });
});

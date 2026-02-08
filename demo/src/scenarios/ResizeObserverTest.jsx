import React, { useState, useRef, useLayoutEffect } from 'react';
import Tag from './Tags';

export default function ResizeObserverTest() {
  const [count, setCount] = useState(0);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      setMeasuredWidth(w);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  // Width changes based on count
  const width = 200 + (count % 3) * 50;

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        ResizeObserver setState
        <Tag type="sync" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        A <code className="bg-gray-100 px-1 rounded">ResizeObserver</code> calls{' '}
        <code className="bg-gray-100 px-1 rounded">setState</code> when an element resizes.
        The callback fires before paint, causing a synchronous re-render that blocks the frame.
      </p>
      <div
        ref={ref}
        style={{ width: `${width}px`, transition: 'none' }}
        className="bg-gray-200 h-8 rounded mb-2 flex items-center justify-center text-xs text-gray-500"
      >
        {width}px
      </div>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Resize (count: {count}, measured: {measuredWidth}px)
      </button>
    </div>
  );
}

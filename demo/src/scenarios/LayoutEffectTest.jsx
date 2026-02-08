import React, { useState, useLayoutEffect } from 'react';
import Tag from './Tags';

export default function LayoutEffectTest() {
  const [count, setCount] = useState(0);
  const [adjusted, setAdjusted] = useState(0);

  useLayoutEffect(() => {
    if (count > 0) {
      setAdjusted(count * 2);
    }
  }, [count]);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        useLayoutEffect setState
        <Tag type="sync" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Clicking increments count, then <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> synchronously
        doubles it into a second state variable. Triggers 1 detection per click.
      </p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger (count: {count}, adjusted: {adjusted})
      </button>
    </div>
  );
}

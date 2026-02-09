import React, { useState, useLayoutEffect } from 'react';
import Tag from './Tags';

export default function MicrotaskLayoutEffectTest() {
  const [count, setCount] = useState(0);
  const [derived, setDerived] = useState(0);

  useLayoutEffect(() => {
    if (count > 0) {
      queueMicrotask(() => {
        setDerived(count * 2);
      });
    }
  }, [count]);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        useLayoutEffect + microtask setState
        <Tag type="sync" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Like <code className="bg-gray-100 px-1 rounded">LayoutEffectTest</code>, but the setState is called inside
        a <code className="bg-gray-100 px-1 rounded">queueMicrotask</code> queued by the layout effect.
        Triggers 1 detection per click with pattern <code className="bg-gray-100 px-1 rounded">setState-via-microtask</code>.
      </p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger (count: {count}, derived: {derived})
      </button>
    </div>
  );
}

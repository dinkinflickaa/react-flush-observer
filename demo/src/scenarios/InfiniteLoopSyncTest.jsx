import React, { useState, useLayoutEffect } from 'react';
import Tag from './Tags';

function InfiniteLooper({ active }) {
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    if (active && count < 1000) {
      // Unconditional setState in layout effect = synchronous infinite loop
      setCount(c => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">renders: {count}</span>;
}

export default function InfiniteLoopSyncTest() {
  const [active, setActive] = useState(false);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Sync setState loop
        <Tag type="sync" />
        <Tag type="react-capped" />
        <Tag type="brief-freeze" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-2">
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> unconditionally calls setState,
        creating a synchronous cascade that re-renders on every commit.
      </p>
      <p className="text-xs text-gray-400 mb-3">
        React's <code className="bg-gray-100 px-1 rounded text-gray-500">NESTED_UPDATE_LIMIT</code> throws
        after 50 nested updates via <code className="bg-gray-100 px-1 rounded text-gray-500">scheduleUpdateOnFiber</code>.
        The browser freezes briefly but recovers.
      </p>
      <button
        onClick={() => setActive(true)}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger sync loop
      </button>
      {active && <InfiniteLooper active={active} />}
    </div>
  );
}

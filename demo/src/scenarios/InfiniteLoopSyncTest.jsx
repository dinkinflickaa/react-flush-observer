import React, { useState, useLayoutEffect } from 'react';

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
        Infinite loop (sync)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
          infinite-loop-sync
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> unconditionally calls setState,
        creating a synchronous cascade. Observer throws <code className="bg-gray-100 px-1 rounded">InfiniteLoopError</code> at
        threshold to stop the freeze.
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

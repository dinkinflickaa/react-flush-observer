import React, { useState, useEffect } from 'react';

function AsyncLooper({ active }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (active) {
      // Unconditional setState in passive effect = async infinite loop
      setCount(c => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">renders: {count}</span>;
}

export default function InfiniteLoopAsyncTest() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = () => {
    setError(null);
    setActive(true);
  };

  // Listen for uncaught InfiniteLoopError
  React.useEffect(() => {
    const handler = (event) => {
      if (event.error?.name === 'InfiniteLoopError') {
        event.preventDefault();
        setError(event.error.message);
        setActive(false);
      }
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Infinite loop (async)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
          infinite-loop-async
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useEffect</code> unconditionally calls setState,
        creating a rapid async re-render loop. Observer detects when commits exceed threshold
        within the time window.
      </p>
      <button
        onClick={handleClick}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger async loop
      </button>
      {active && <AsyncLooper active={active} />}
      {error && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 font-mono">
          {error}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from "react";
import Tag from "./Tags";

function AsyncLooper({ active }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (active) {
      // Unconditional setState in passive effect = async infinite loop
      setCount((c) => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">renders: {count}</span>;
}

export default function InfiniteLoopAsyncTest() {
  const [active, setActive] = useState(false);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Async setState loop
        <Tag type="async" />
        <Tag type="no-react-cap" />
        <Tag type="burns-cpu" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-2">
        <code className="bg-gray-100 px-1 rounded">useEffect</code>{" "}
        unconditionally calls setState, creating a rapid async re-render loop.
        Each effect fires in a new task, so commits never stack within a single synchronous batch.
      </p>
      <p className="text-xs text-gray-400 mb-3">
        Each setState goes through a fresh <code className="bg-gray-100 px-1 rounded text-gray-500">scheduleUpdateOnFiber</code> call
        with <code className="bg-gray-100 px-1 rounded text-gray-500">nestedUpdateCount</code> reset to 0,
        so <code className="bg-gray-100 px-1 rounded text-gray-500">NESTED_UPDATE_LIMIT</code> never fires.
        The browser stays responsive but the loop never stops — burning CPU and re-rendering forever.
      </p>
      <button
        onClick={() => setActive(true)}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger async loop
      </button>
      {active && <AsyncLooper active={active} />}
    </div>
  );
}

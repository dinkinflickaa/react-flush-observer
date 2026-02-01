import React, { useState, useLayoutEffect, useEffect } from 'react';

/**
 * Demonstrates how useEffect state updates become BLOCKING in legacy
 * ReactDOM.render mode when a useLayoutEffect forces a sync re-render.
 *
 * Flow:
 *   render → useLayoutEffect setState (force flush)
 *         → sync re-render flushes pending useEffect
 *         → useEffect setState → sync re-render
 *         → useEffect setState → sync re-render  (infinite, blocking)
 *
 * The useLayoutEffect is just the catalyst — after the first force flush,
 * the loop is sustained entirely by useEffect because legacy React
 * processes all state updates synchronously.
 */

/**
 * Fires once on activation to force a synchronous re-render.
 * This starts the force-flush cascade that makes passive effects blocking.
 */
function LayoutEffectTrigger({ active }) {
  const [triggered, setTriggered] = useState(false);

  useLayoutEffect(() => {
    if (active && !triggered) {
      setTriggered(true); // one-shot: forces a sync re-render
    }
  }, [active, triggered]);

  return (
    <span className="text-xs text-gray-400 ml-2">
      trigger: {triggered ? 'fired' : 'waiting'}
    </span>
  );
}

/**
 * Unconditional setState in useEffect.  Normally non-blocking (each render
 * in a separate macrotask in concurrent mode), but once a sibling's
 * useLayoutEffect forces a sync re-render, React flushes this passive
 * effect synchronously — creating a blocking infinite loop in legacy mode.
 */
function EffectLoop({ active }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (active) {
      setCount(c => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">effect renders: {count}</span>;
}

export default function InfiniteLoopHybridTest() {
  const [active, setActive] = useState(false);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Infinite loop (useEffect after force flush)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
          infinite-loop-sync
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> fires once to force a sync re-render.
        This flushes pending <code className="bg-gray-100 px-1 rounded">useEffect</code> callbacks synchronously.
        The useEffect calls setState on every render, sustaining a <strong>blocking</strong> infinite loop
        in legacy <code className="bg-gray-100 px-1 rounded">ReactDOM.render</code> mode.
      </p>
      <button
        onClick={() => setActive(true)}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger hybrid loop
      </button>
      {active && (
        <>
          <LayoutEffectTrigger active={active} />
          <EffectLoop active={active} />
        </>
      )}
    </div>
  );
}

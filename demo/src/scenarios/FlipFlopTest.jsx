import React, { useState, useLayoutEffect, useEffect } from 'react';

/**
 * Flip-flop chain: useLayoutEffect and useEffect alternate state updates.
 *
 * click → render → useLayoutEffect setState → sync re-render
 *       → useEffect setState → re-render → useLayoutEffect setState → …
 *
 * Question: does React's built-in 50-iteration limit catch this,
 * or does the alternation between layout and passive effects bypass it?
 */
function FlipFlopper({ active }) {
  const [layoutCount, setLayoutCount] = useState(0);
  const [effectCount, setEffectCount] = useState(0);

  useLayoutEffect(() => {
    if (active && layoutCount < 1000) {
      setLayoutCount(c => c + 1);
    }
  }, [active, effectCount]); // fires when effectCount changes

  useEffect(() => {
    if (active && effectCount < 1000) {
      setEffectCount(c => c + 1);
    }
  }, [active, layoutCount]); // fires when layoutCount changes

  return (
    <span className="text-xs text-gray-500 ml-2">
      layout: {layoutCount}, effect: {effectCount}
    </span>
  );
}

export default function FlipFlopTest() {
  const [active, setActive] = useState(false);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Flip-flop (layout ↔ effect)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-orange-100 text-orange-800">
          experimental
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> and{' '}
        <code className="bg-gray-100 px-1 rounded">useEffect</code> alternate
        state updates, creating a flip-flop chain. Capped at 1000 iterations.
        Does React's 50-iteration limit catch this?
      </p>
      <button
        onClick={() => setActive(true)}
        className="px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger flip-flop
      </button>
      {active && <FlipFlopper active={active} />}
    </div>
  );
}

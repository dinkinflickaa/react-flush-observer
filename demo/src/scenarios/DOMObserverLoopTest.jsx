import React, { useState, useEffect, useRef } from 'react';
import Tag from './Tags';

// MutationObserver watching React's own container creates a feedback loop:
// React commits DOM changes → MutationObserver fires → setState → re-render →
// commit → DOM changes → MutationObserver fires...
//
// This is completely outside React's detection because the setState originates
// from a browser callback, not from React's commit phase. The nested update
// counter never increments because each cycle is a fresh async update.
function DOMObserverLooper({ active }) {
  const [count, setCount] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const observer = new MutationObserver(() => {
      // React DOM mutation triggers observer → setState → re-render → commit
      // → DOM mutation → observer fires again... forever
      setCount(c => c + 1);
    });
    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // Kick-start the feedback loop: this setState causes a DOM mutation,
    // which the MutationObserver sees, which calls setState again, forever.
    setCount(1);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div ref={containerRef}>
      <span className="text-xs text-gray-500 ml-2">renders: {count}</span>
    </div>
  );
}

export default function DOMObserverLoopTest() {
  const [active, setActive] = useState(false);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        DOM MutationObserver loop
        <Tag type="async" />
        <Tag type="no-react-cap" />
        <Tag type="unresponsive" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-2">
        A <code className="bg-gray-100 px-1 rounded">MutationObserver</code> watches React's own container.
        Each commit mutates the DOM, which fires the observer, which calls{' '}
        <code className="bg-gray-100 px-1 rounded">setState</code>, triggering another render.
      </p>
      <p className="text-xs text-gray-400 mb-3">
        Completely invisible to React — the{' '}
        <code className="bg-gray-100 px-1 rounded text-gray-500">setState</code> originates from a browser
        callback, not from React's commit phase. The nested update counter never increments because
        each cycle is a fresh async update. The browser stays responsive but React burns CPU forever.
      </p>
      <button
        onClick={() => setActive(true)}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger DOM observer loop
      </button>
      {active && <DOMObserverLooper active={active} />}
    </div>
  );
}

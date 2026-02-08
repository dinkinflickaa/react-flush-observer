import React, { useState, Suspense } from 'react';
import Tag from './Tags';

export default function LazyInRenderTest() {
  const [show, setShow] = useState(false);

  // Creating React.lazy inside render is the anti-pattern being tested
  const LazyComponent = React.lazy(() =>
    Promise.resolve({
      default: function LazyGreeting() {
        return <span className="text-violet-600 font-semibold">Lazy loaded!</span>;
      },
    })
  );

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        React.lazy in render
        <Tag type="sync" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Creates <code className="bg-gray-100 px-1 rounded">React.lazy</code> inside render. When shown, the Suspense
        fallback resolves immediately, causing a synchronous re-commit. 1 detection when shown.
      </p>
      <button
        onClick={() => setShow(s => !s)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        {show ? 'Hide' : 'Show'} Lazy Component
      </button>
      {show && (
        <Suspense fallback={<span className="text-gray-400">Loading...</span>}>
          <LazyComponent />
        </Suspense>
      )}
    </div>
  );
}

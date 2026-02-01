import React, { useState, useEffect } from 'react';

export default function HappyPathTest() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = `Happy path: ${count}`;
  }, [count]);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Normal useEffect (happy path)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-800">
          no detection
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Standard <code className="bg-gray-100 px-1 rounded">useEffect</code> that updates{' '}
        <code className="bg-gray-100 px-1 rounded">document.title</code>. Should produce zero detections no matter how
        many times you click.
      </p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Increment (count: {count})
      </button>
    </div>
  );
}

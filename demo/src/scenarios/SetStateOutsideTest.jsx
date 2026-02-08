import React, { useState } from 'react';
import Tag from './Tags';

export default function SetStateOutsideTest() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  function handleClick() {
    setTimeout(() => {
      setA(x => x + 1);
      setB(x => x + 1);
    }, 0);
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        setState outside React
        <Tag type="async" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Two <code className="bg-gray-100 px-1 rounded">setState</code> calls inside{' '}
        <code className="bg-gray-100 px-1 rounded">setTimeout</code>. In legacy mode, these are unbatched and cause two
        commits in the same task. 1 detection per click.
      </p>
      <button
        onClick={handleClick}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger (a: {a}, b: {b})
      </button>
    </div>
  );
}

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import Tag from './Tags';

export default function FlushSyncTest() {
  const [synced, setSynced] = useState(0);
  const [after, setAfter] = useState(0);

  function handleClick() {
    ReactDOM.flushSync(() => {
      setSynced(x => x + 1);
    });
    setAfter(x => x + 1);
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        flushSync (false positive)
        <Tag type="sync" />
        <Tag type="false-positive" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">flushSync</code> forces a commit, then the following{' '}
        <code className="bg-gray-100 px-1 rounded">setState</code> triggers another in the same task. Known false
        positive — 1 detection per click.
      </p>
      <button
        onClick={handleClick}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger (synced: {synced}, after: {after})
      </button>
    </div>
  );
}

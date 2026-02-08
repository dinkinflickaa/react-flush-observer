import React, { useState, useLayoutEffect } from 'react';
import Tag from './Tags';

export default function CascadeTest() {
  const [step, setStep] = useState(0);
  const [derived1, setDerived1] = useState(0);
  const [derived2, setDerived2] = useState(0);

  useLayoutEffect(() => {
    if (step > 0) {
      setDerived1(step * 10);
    }
  }, [step]);

  useLayoutEffect(() => {
    if (derived1 > 0) {
      setDerived2(derived1 + 1);
    }
  }, [derived1]);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        3-commit cascade
        <Tag type="sync" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Two chained <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> setState calls create 3 commits
        per click. Expect exactly 2 detections (one for each extra commit).
      </p>
      <button
        onClick={() => setStep(s => s + 1)}
        className="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger (step: {step}, d1: {derived1}, d2: {derived2})
      </button>
    </div>
  );
}

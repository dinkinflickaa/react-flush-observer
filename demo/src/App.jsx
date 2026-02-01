import React from 'react';
import LayoutEffectTest from './scenarios/LayoutEffectTest';
import LazyInRenderTest from './scenarios/LazyInRenderTest';
import SetStateOutsideTest from './scenarios/SetStateOutsideTest';
import HappyPathTest from './scenarios/HappyPathTest';
import FlushSyncTest from './scenarios/FlushSyncTest';
import CascadeTest from './scenarios/CascadeTest';

export default function App() {
  return (
    <div className="flex flex-col gap-4">
      <LayoutEffectTest />
      <LazyInRenderTest />
      <SetStateOutsideTest />
      <HappyPathTest />
      <FlushSyncTest />
      <CascadeTest />
    </div>
  );
}

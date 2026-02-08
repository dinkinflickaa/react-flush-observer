import React from 'react';

const TAG_STYLES = {
  'react-capped':    { bg: 'bg-amber-100',  text: 'text-amber-800',  label: 'React capped' },
  'no-react-cap':    { bg: 'bg-rose-100',   text: 'text-rose-800',   label: 'no React cap' },
  'brief-freeze':    { bg: 'bg-orange-100',  text: 'text-orange-800', label: 'brief freeze' },
  'unresponsive':    { bg: 'bg-red-100',     text: 'text-red-800',    label: 'unresponsive' },
  'burns-cpu':       { bg: 'bg-yellow-100',  text: 'text-yellow-800', label: 'burns CPU' },
  'no-detection':    { bg: 'bg-green-100',   text: 'text-green-800',  label: 'no detection' },
  'false-positive':  { bg: 'bg-gray-100',    text: 'text-gray-600',   label: 'false positive' },
  'sync':            { bg: 'bg-blue-100',    text: 'text-blue-800',   label: 'sync' },
  'async':           { bg: 'bg-indigo-100',  text: 'text-indigo-800', label: 'async' },
  'commit-phase':    { bg: 'bg-purple-100',  text: 'text-purple-800', label: 'commit phase' },
};

export default function Tag({ type }) {
  const style = TAG_STYLES[type];
  if (!style) return null;
  return (
    <span className={`ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

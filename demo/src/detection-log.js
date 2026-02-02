let container = null;
let logBody = null;
let countEl = null;
let count = 0;

const PATTERN_STYLES = {
  'setState-in-layout-effect': {
    bg: 'bg-amber-50',
    border: 'border-amber-400',
    label: 'Layout Effect',
  },
  'lazy-in-render': {
    bg: 'bg-violet-50',
    border: 'border-violet-400',
    label: 'Lazy in Render',
  },
  'setState-outside-react': {
    bg: 'bg-red-50',
    border: 'border-red-400',
    label: 'Outside React',
  },
  'infinite-loop-sync': {
    bg: 'bg-rose-50',
    border: 'border-rose-600',
    label: 'Infinite Loop (Sync)',
  },
  'infinite-loop-async': {
    bg: 'bg-rose-50',
    border: 'border-rose-600',
    label: 'Infinite Loop (Async)',
  },
};

export function initLog(el) {
  container = el;
  count = 0;

  container.className = 'bg-white rounded-lg shadow sticky top-6 self-start flex flex-col max-h-[calc(100vh-48px)]';

  // Header
  const header = document.createElement('div');
  header.className = 'flex justify-between items-center px-4 py-3 border-b border-gray-200';

  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-gray-900';
  title.innerHTML = 'Detection Log (<span id="detection-count">0</span>)';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-2.5 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50 cursor-pointer text-gray-700';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', clearLog);

  header.appendChild(title);
  header.appendChild(clearBtn);

  // Body
  logBody = document.createElement('div');
  logBody.className = 'overflow-y-auto p-2 flex-1';

  const empty = document.createElement('div');
  empty.className = 'text-center py-10 px-4 text-gray-400 text-sm';
  empty.id = 'log-empty';
  empty.textContent = 'No detections yet. Click a test button.';
  logBody.appendChild(empty);

  container.appendChild(header);
  container.appendChild(logBody);

  countEl = container.querySelector('#detection-count');
}

export function appendDetection(detection) {
  if (!logBody) return;

  // Remove empty placeholder
  const empty = logBody.querySelector('#log-empty');
  if (empty) empty.remove();

  count++;
  if (countEl) countEl.textContent = count;

  const style = PATTERN_STYLES[detection.pattern] || PATTERN_STYLES['setState-outside-react'];

  const entry = document.createElement('div');
  entry.className = `p-2 px-3 rounded-md mb-1.5 text-sm border-l-4 ${style.bg} ${style.border}`;

  const pattern = document.createElement('span');
  pattern.className = 'font-semibold text-gray-900';
  pattern.textContent = style.label;

  // Suspect component names — deduplicate via ownerName
  const seen = new Set();
  const suspectNames = (detection.suspects || [])
    .map(s => {
      const name = s.ownerName || s.type?.displayName || s.type?.name;
      // For Suspense suspects, append the resolved lazy component name
      if (s.resolvedName && s.resolvedName !== name) {
        return name ? `${name} → lazy(${s.resolvedName})` : `lazy(${s.resolvedName})`;
      }
      return name;
    })
    .filter(name => name && !seen.has(name) && seen.add(name));

  if (suspectNames.length > 0) {
    const suspects = document.createElement('span');
    suspects.className = 'text-gray-700 text-xs font-mono block mt-0.5';
    suspects.textContent = suspectNames.join(' → ');
    entry.appendChild(pattern);
    entry.appendChild(suspects);
  } else {
    entry.appendChild(pattern);
  }

  const evidence = document.createElement('span');
  evidence.className = 'text-gray-500 text-xs block mt-0.5';
  evidence.textContent = detection.evidence;

  entry.appendChild(evidence);

  // Dev-mode enrichment: source location, component stack, effect source
  const firstSuspect = (detection.suspects || [])[0];
  if (firstSuspect) {
    if (firstSuspect.source) {
      const src = firstSuspect.source;
      const short = src.fileName ? src.fileName.replace(/^.*\/src\//, 'src/') : null;
      if (short) {
        const sourceEl = document.createElement('span');
        sourceEl.className = 'text-blue-600 text-xs font-mono block mt-1';
        sourceEl.textContent = `📍 ${short}:${src.lineNumber}:${src.columnNumber}`;
        entry.appendChild(sourceEl);
      }
    }
    if (firstSuspect.componentStack && firstSuspect.componentStack.length > 0) {
      const stackEl = document.createElement('span');
      stackEl.className = 'text-gray-600 text-xs font-mono block mt-0.5';
      stackEl.textContent = `🧩 ${firstSuspect.componentStack.join(' → ')}`;
      entry.appendChild(stackEl);
    }
    if (firstSuspect.effectSource) {
      const effectEl = document.createElement('span');
      effectEl.className = 'text-orange-700 text-xs font-mono block mt-1 whitespace-pre-wrap bg-orange-50 rounded px-2 py-1 border border-orange-200';
      effectEl.textContent = firstSuspect.effectSource;
      entry.appendChild(effectEl);
    }
  }
  if (detection.setStateLocation) {
    const loc = detection.setStateLocation;
    const short = loc.fileName ? loc.fileName.replace(/^.*\/src\//, 'src/') : null;
    if (short) {
      const locEl = document.createElement('span');
      locEl.className = 'text-red-600 text-xs font-mono block mt-1';
      locEl.textContent = `📍 setState at ${short}:${loc.lineNumber}:${loc.columnNumber}`;
      entry.appendChild(locEl);
    }
  }

  const meta = document.createElement('span');
  meta.className = 'text-gray-400 text-[11px] block mt-0.5';

  if (detection.type === 'infinite-loop') {
    const windowInfo = detection.windowMs != null ? ` in ${detection.windowMs.toFixed(0)}ms` : '';
    meta.textContent = `${detection.commitCount} commits${windowInfo} · ${new Date(detection.timestamp).toLocaleTimeString()}`;

    const loopMeta = document.createElement('span');
    loopMeta.className = 'text-rose-600 text-xs font-semibold block mt-0.5';
    loopMeta.textContent = `⚠ Infinite loop detected (${detection.pattern})`;
    entry.appendChild(loopMeta);
  } else {
    meta.textContent = `${detection.flushedEffectsCount} effect(s) flushed · ${detection.blockingDurationMs.toFixed(2)}ms blocking · ${new Date(detection.timestamp).toLocaleTimeString()}`;
  }

  entry.appendChild(meta);

  logBody.prepend(entry);
}

export function clearLog() {
  if (!logBody) return;
  logBody.innerHTML = '';
  count = 0;
  if (countEl) countEl.textContent = '0';

  const empty = document.createElement('div');
  empty.className = 'text-center py-10 px-4 text-gray-400 text-sm';
  empty.id = 'log-empty';
  empty.textContent = 'No detections yet. Click a test button.';
  logBody.appendChild(empty);
}

// React Fiber types (subset used by this library)

export interface DebugSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface Effect {
  tag: number;
  create: () => unknown;
  next: Effect;
}

export interface UpdateQueue {
  lastEffect?: Effect;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FiberType = ((...args: any[]) => any) | {
  displayName?: string;
  name?: string;
  __componentId?: unknown;
} | string | null;

export interface Fiber {
  tag: number;
  flags: number;
  type?: FiberType;
  lanes: number;
  childLanes: number;
  subtreeFlags: number;
  current?: Fiber;
  alternate?: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  updateQueue?: UpdateQueue | null;
  _debugSource?: DebugSource;
  _debugOwner?: Fiber;
}

export interface FrozenOriginals {
  pendingLanes: number;
  callbackPriority: number;
  callbackNode: unknown;
}

export interface FiberRoot {
  current: Fiber;
  pendingLanes: number;
  callbackPriority: number;
  callbackNode: unknown;
  __frozenOriginals?: FrozenOriginals;
}

// Snapshot types

export interface SourceInfo {
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

export interface FiberInfo {
  componentId: unknown;
  tag: number;
  type: unknown;
  ownerName: string | null;
}

export interface DetailedFiberInfo extends FiberInfo {
  source: SourceInfo | null;
  componentStack: string[] | null;
  effectSource: string | null;
}

export interface SuspenseFiberInfo extends FiberInfo {
  resolvedName: string | null;
}

export interface UpdatesFiberInfo extends FiberInfo {
  lanes: number;
}

export interface FiberSnapshot {
  withPassiveEffects: FiberInfo[];
  withLayoutEffects: DetailedFiberInfo[];
  withSuspense: SuspenseFiberInfo[];
  withUpdates: UpdatesFiberInfo[];
}

// Detection types

export type FlushPattern =
  | 'setState-outside-react'
  | 'setState-in-layout-effect'
  | 'setState-via-microtask'
  | 'setState-in-observer'
  | 'lazy-in-render'
  | 'flushSync';

export type LoopPattern = 'sync' | 'async';

export interface ClassificationResult {
  pattern: FlushPattern;
  suspects: FiberInfo[];
  evidence: string;
}

export interface FlushReport {
  type: 'flush';
  timestamp: number;
  pattern: FlushPattern;
  evidence: string;
  suspects: FiberInfo[];
  flushedEffectsCount: number;
  blockingDurationMs: number;
  setStateLocation?: SourceInfo | null;
  /** First user-code frame from the commit call stack (parsed via Error().stack). */
  userFrame: SourceInfo | null;
}

export interface LoopReport {
  type: 'loop';
  pattern: LoopPattern;
  commitCount: number;
  windowMs: number | null;
  stack: string | null;
  suspects: string[];
  triggeringCommit: FiberSnapshot | null;
  forcedCommit: FiberSnapshot;
  userFrame: SourceInfo | null;
  timestamp: number;
}

export type Report = FlushReport | LoopReport;

// Config types

export interface BreakOnLoopConfig {
  sync?: boolean;
  async?: boolean;
}

export interface InstallConfig {
  onFlush?: (report: FlushReport) => void;
  onLoop?: (report: LoopReport) => void;
  breakOnLoop?: boolean | BreakOnLoopConfig;
  sampleRate?: number;
  maxCommitsPerTask?: number;
  maxCommitsPerWindow?: number;
  windowMs?: number;
}

export interface DetectorConfig {
  sampleRate: number;
  onFlush: ((report: FlushReport) => void) | null;
  onLoop: ((report: LoopReport) => void) | null;
  breakOnLoop: boolean | BreakOnLoopConfig;
  maxCommitsPerTask: number;
  maxCommitsPerWindow: number;
  windowMs: number;
}

// Detector interface

export interface Detector {
  handleCommit(root: FiberRoot): void;
  setBreakOnLoop(enabled: boolean | BreakOnLoopConfig): void;
  dispose(): void;
}

// React DevTools hook types

export interface ReactInternals {
  version?: string;
  rendererPackageName?: string;
}

export interface ReactDevToolsHook {
  supportsFiber: boolean;
  inject(internals: ReactInternals): number;
  onCommitFiberRoot(
    id: number,
    root: FiberRoot,
    priority: number,
    didError: boolean
  ): void;
  onPostCommitFiberRoot(id: number, root: FiberRoot): void;
  onCommitFiberUnmount(id: number, fiber: Fiber): void;
}

// Global augmentation
declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: Partial<ReactDevToolsHook>;
  }
}

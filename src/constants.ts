// Fiber tags (React's WorkTag enum — stable across dev/prod)
export const FunctionComponent = 0;
export const ClassComponent = 1;
export const SuspenseComponent = 13;
export const OffscreenComponent = 22;

// Fiber flags (bitmask on fiber.flags — stable across dev/prod)
export const Placement = 0b00000000000000000000000001; // 1
export const Passive = 0b00000000000000100000000000; // 2048
export const Update = 0b00000000000000000000000100; // 4
export const LayoutMask = 0b00000000000000000000100100; // 36
export const DidCapture = 0b00000000000000010000000000; // 1024
export const Visibility = 0b00000000000010000000000000; // 8192

// Infinite loop detection defaults
export const DEFAULT_MAX_COMMITS_PER_TASK = 50;
export const DEFAULT_MAX_COMMITS_PER_WINDOW = 50;
export const DEFAULT_WINDOW_MS = 1000;

// Lane constants
export const SyncLane = 1;
export const NoLane = 0;

// Effect tags
export const HookHasEffect = 0b0001; // 1 — effect needs to fire (deps changed or mount)
export const HookLayout = 0b0100; // 4

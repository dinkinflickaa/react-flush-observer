import type {
  Fiber,
  FiberRoot,
  FiberSnapshot,
  FiberInfo,
  DetailedFiberInfo,
  SuspenseFiberInfo,
  UpdatesFiberInfo,
  SourceInfo,
  Effect,
} from './types';
import {
  FunctionComponent,
  ClassComponent,
  SuspenseComponent,
  OffscreenComponent,
  Passive,
  LayoutMask,
  DidCapture,
  Visibility,
  HookHasEffect,
  HookLayout,
} from './constants';

function getComponentName(fiber: Fiber): string | null {
  const type = fiber.type;
  if (!type) {
    return null;
  }
  if (typeof type === 'string') {
    return type;
  }
  if (typeof type === 'function') {
    return (type as { displayName?: string; name?: string }).displayName || type.name || null;
  }
  if (typeof type === 'object' && type !== null) {
    return type.displayName || type.name || null;
  }
  return null;
}

function getComponentId(fiber: Fiber): unknown {
  const type = fiber.type;
  if (typeof type === 'function') {
    return (type as { __componentId?: unknown }).__componentId;
  }
  if (typeof type === 'object' && type !== null) {
    return type.__componentId;
  }
  return undefined;
}

function readDebugSource(fiber: Fiber): SourceInfo | null {
  const source = fiber._debugSource;
  if (!source) {
    return null;
  }
  return {
    fileName: source.fileName || null,
    lineNumber: source.lineNumber ?? null,
    columnNumber: source.columnNumber ?? null,
  };
}

function buildComponentStack(fiber: Fiber): string[] | null {
  const stack: string[] = [];
  let owner = fiber._debugOwner;

  while (owner) {
    const name = getComponentName(owner);
    if (name) {
      stack.push(name);
    }
    owner = owner._debugOwner;
  }

  return stack.length > 0 ? stack : null;
}

function readLayoutEffectSource(fiber: Fiber): string | null {
  const queue = fiber.updateQueue;
  if (!queue?.lastEffect) {
    return null;
  }

  // Effects form a circular linked list.
  // Only match effects with both HookLayout AND HookHasEffect — the latter
  // indicates the effect needs to fire (deps changed or mount).  This filters
  // out stale layout effects on fibers reused from a previous commit.
  const needed = HookLayout | HookHasEffect;
  const firstEffect = queue.lastEffect.next;
  let effect: Effect = firstEffect;

  do {
    if ((effect.tag & needed) === needed) {
      try {
        return effect.create.toString();
      } catch {
        return null;
      }
    }
    effect = effect.next;
  } while (effect !== firstEffect);

  return null;
}

/**
 * Returns true if any bits in `mask` are newly set on this fiber
 * compared to its alternate (the previous committed version).
 * On mount (no alternate), all set bits are considered new.
 */
function hasNewFlags(fiber: Fiber, mask: number): boolean {
  const current = fiber.flags & mask;
  if (current === 0) return false;
  if (!fiber.alternate) return true;
  const previous = fiber.alternate.flags & mask;
  return (current & ~previous) !== 0;
}

function isComponentFiber(fiber: Fiber): boolean {
  return fiber.tag === FunctionComponent || fiber.tag === ClassComponent;
}

function walkFiber(
  fiber: Fiber,
  result: FiberSnapshot,
  nearestComponent: Fiber | null
): void {
  const isComponent = isComponentFiber(fiber);
  const currentComponent = isComponent ? fiber : nearestComponent;
  const ownerName = nearestComponent ? getComponentName(nearestComponent) : null;

  const baseInfo: FiberInfo = {
    componentId: getComponentId(fiber),
    tag: fiber.tag,
    type: fiber.type,
    ownerName,
  };

  // Check for passive effects (only the fiber itself, not subtree)
  if ((fiber.flags & Passive) !== 0) {
    result.withPassiveEffects.push(baseInfo);
  }

  // Check for layout effects — only on component fibers (function/class).
  // Host elements (DOM nodes) get LayoutMask for content updates which are
  // not layout effects and would pollute the suspects list.
  if ((fiber.flags & LayoutMask) !== 0 && isComponent) {
    const detailedInfo: DetailedFiberInfo = {
      ...baseInfo,
      source: readDebugSource(fiber),
      componentStack: buildComponentStack(fiber),
      effectSource: readLayoutEffectSource(fiber),
    };
    result.withLayoutEffects.push(detailedInfo);
  }

  // Check for Suspense boundaries — only NEWLY captured (not stale from
  // a previous commit where the lazy component already resolved).
  if (fiber.tag === SuspenseComponent && hasNewFlags(fiber, DidCapture)) {
    // Try to get the lazy component name from the child
    let resolvedName: string | null = null;
    if (fiber.child) {
      resolvedName = getComponentName(fiber.child);
    }
    const suspenseInfo: SuspenseFiberInfo = {
      ...baseInfo,
      resolvedName,
    };
    result.withSuspense.push(suspenseInfo);
  }

  // Check for Offscreen with visibility changes — only newly set
  if (fiber.tag === OffscreenComponent && hasNewFlags(fiber, Visibility)) {
    const suspenseInfo: SuspenseFiberInfo = {
      ...baseInfo,
      resolvedName: null,
    };
    result.withSuspense.push(suspenseInfo);
  }

  // Check for pending updates or re-rendered components.
  // At commit time, lanes for the committed work are already cleared, so
  // also detect component fibers whose memoizedState changed vs. their
  // alternate — this captures components that re-rendered with new state
  // (e.g., setState called from an observer callback).
  const hasLanes = fiber.lanes !== 0 || fiber.childLanes !== 0;
  const stateChanged = isComponent
    && fiber.alternate != null
    && fiber.memoizedState !== fiber.alternate.memoizedState;
  if (hasLanes || stateChanged) {
    const updatesInfo: UpdatesFiberInfo = {
      ...baseInfo,
      lanes: fiber.lanes | fiber.childLanes,
    };
    result.withUpdates.push(updatesInfo);
  }

  // Traverse children
  if (fiber.child) {
    walkFiber(fiber.child, result, currentComponent);
  }

  // Traverse siblings
  if (fiber.sibling) {
    walkFiber(fiber.sibling, result, nearestComponent);
  }
}

export function snapshotFromFiber(rootFiber: Fiber): FiberSnapshot {
  const result: FiberSnapshot = {
    withPassiveEffects: [],
    withLayoutEffects: [],
    withSuspense: [],
    withUpdates: [],
  };

  walkFiber(rootFiber, result, null);
  return result;
}

export function snapshotCommitFibers(root: FiberRoot): FiberSnapshot {
  const rootFiber = root.current;
  if (rootFiber) {
    return snapshotFromFiber(rootFiber);
  }

  return {
    withPassiveEffects: [],
    withLayoutEffects: [],
    withSuspense: [],
    withUpdates: [],
  };
}

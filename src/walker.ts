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

  // Effects form a circular linked list
  const firstEffect = queue.lastEffect.next;
  let effect: Effect = firstEffect;

  do {
    // HookLayout = 0b0100, indicates a layout effect
    if ((effect.tag & HookLayout) !== 0) {
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

  // Check for layout effects
  if ((fiber.flags & LayoutMask) !== 0) {
    const detailedInfo: DetailedFiberInfo = {
      ...baseInfo,
      source: readDebugSource(fiber),
      componentStack: buildComponentStack(fiber),
      effectSource: readLayoutEffectSource(fiber),
    };
    result.withLayoutEffects.push(detailedInfo);
  }

  // Check for Suspense boundaries that captured
  if (fiber.tag === SuspenseComponent && (fiber.flags & DidCapture) !== 0) {
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

  // Check for Offscreen with visibility changes (also indicates Suspense)
  if (fiber.tag === OffscreenComponent && (fiber.flags & Visibility) !== 0) {
    const suspenseInfo: SuspenseFiberInfo = {
      ...baseInfo,
      resolvedName: null,
    };
    result.withSuspense.push(suspenseInfo);
  }

  // Check for pending updates
  if (fiber.lanes !== 0 || fiber.childLanes !== 0) {
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

export function snapshotCommitFibers(root: FiberRoot): FiberSnapshot {
  const result: FiberSnapshot = {
    withPassiveEffects: [],
    withLayoutEffects: [],
    withSuspense: [],
    withUpdates: [],
  };

  const rootFiber = root.current;
  if (rootFiber) {
    walkFiber(rootFiber, result, null);
  }

  return result;
}

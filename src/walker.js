const {
  FunctionComponent,
  ClassComponent,
  SuspenseComponent,
  OffscreenComponent,
  Placement,
  Passive,
  LayoutMask,
  DidCapture,
  Visibility,
} = require('./constants');

// React effect tags (bitmask on effect.tag in the updateQueue effect list)
const HookLayout = 0b0100;

function snapshotCommitFibers(root) {
  const result = {
    withPassiveEffects: [],
    withLayoutEffects: [],
    withSuspense: [],
    withUpdates: [],
  };
  walkFiber(root.current, result, null);
  return result;
}

const relevantSubtreeFlags = Passive | LayoutMask | DidCapture | Visibility;

function readDebugSource(fiber) {
  const ds = fiber._debugSource;
  if (!ds) return null;
  return {
    fileName: ds.fileName ?? null,
    lineNumber: ds.lineNumber ?? null,
    columnNumber: ds.columnNumber ?? null,
  };
}

function buildComponentStack(fiber) {
  if (!fiber._debugOwner) return null;
  const stack = [];
  // Start with the fiber itself
  const selfName = fiber.type?.displayName || fiber.type?.name;
  if (selfName) stack.unshift(selfName);
  // Walk _debugOwner chain
  let owner = fiber._debugOwner;
  while (owner) {
    const name = owner.type?.displayName || owner.type?.name;
    if (name) stack.unshift(name);
    owner = owner._debugOwner;
  }
  return stack.length > 0 ? stack : null;
}

function readLayoutEffectSource(fiber) {
  const lastEffect = fiber.updateQueue?.lastEffect;
  if (!lastEffect) return null;
  // Effects form a circular linked list; walk from lastEffect.next (first) back to lastEffect
  let effect = lastEffect.next;
  do {
    if (effect.tag & HookLayout) {
      return typeof effect.create === 'function' ? effect.create.toString() : null;
    }
    effect = effect.next;
  } while (effect && effect !== lastEffect.next);
  return null;
}

function walkFiber(fiber, result, nearestComponent) {
  let current = fiber;
  while (current !== null) {
    const flags = current.flags;
    const tag = current.tag;
    const id = current.type?.__componentId ?? null;

    const isComponent = tag === FunctionComponent || tag === ClassComponent;
    const owner = isComponent ? current : nearestComponent;
    const ownerName = owner?.type?.displayName || owner?.type?.name || null;

    if (flags & Passive) {
      result.withPassiveEffects.push({ componentId: id, tag, type: current.type, ownerName });
    }
    if (flags & LayoutMask) {
      const componentFiber = isComponent ? current : owner;
      result.withLayoutEffects.push({
        componentId: id, tag, type: current.type, ownerName,
        source: readDebugSource(current) || (owner ? readDebugSource(owner) : null),
        componentStack: buildComponentStack(componentFiber),
        effectSource: readLayoutEffectSource(componentFiber),
      });
    }
    if (tag === SuspenseComponent) {
      // DidCapture: Suspense boundary just captured (may be cleared by commit time)
      // Fallback: OffscreenComponent child with Visibility flag = Suspense just resolved
      const offscreen = current.child;
      const justResolved = offscreen
        && offscreen.tag === OffscreenComponent
        && (offscreen.flags & Visibility);

      if ((flags & DidCapture) || justResolved) {
        // Walk the offscreen subtree to find the resolved lazy component
        const resolvedChild = offscreen?.child;
        const resolvedName = resolvedChild?.type?.displayName
          || resolvedChild?.type?.name
          || null;
        result.withSuspense.push({ componentId: id, tag, type: current.type, ownerName, resolvedName });
      }
    }
    if (current.lanes !== 0) {
      result.withUpdates.push({ componentId: id, tag, type: current.type, lanes: current.lanes, ownerName });
    }

    if (current.subtreeFlags & relevantSubtreeFlags || current.childLanes !== 0) {
      walkFiber(current.child, result, owner);
    }
    current = current.sibling;
  }
}

module.exports = { snapshotCommitFibers };

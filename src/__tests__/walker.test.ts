import { snapshotCommitFibers } from '../walker';
import {
  FunctionComponent,
  SuspenseComponent,
  OffscreenComponent,
  Passive,
  LayoutMask,
  DidCapture,
  Visibility,
} from '../constants';
import type { Fiber, FiberRoot, Effect } from '../types';

// Helper to build a mock fiber node
function makeFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: FunctionComponent,
    type: overrides.type ?? function MockComponent() {},
    flags: 0,
    subtreeFlags: 0,
    lanes: 0,
    childLanes: 0,
    child: null,
    sibling: null,
    ...overrides,
  };
}

// Helper to build a mock FiberRoot
function makeRoot(currentFiber: Fiber | null): FiberRoot {
  return {
    current: currentFiber as Fiber,
    pendingLanes: 0,
    callbackPriority: 0,
    callbackNode: null,
  };
}

describe('snapshotCommitFibers', () => {
  test('returns empty arrays for a tree with no relevant flags', () => {
    const root = makeRoot(makeFiber());
    const result = snapshotCommitFibers(root);
    expect(result.withPassiveEffects).toEqual([]);
    expect(result.withLayoutEffects).toEqual([]);
    expect(result.withSuspense).toEqual([]);
    expect(result.withUpdates).toEqual([]);
  });

  test('collects fibers with Passive flag', () => {
    const MyComp = function MyComp() {};
    const child = makeFiber({ flags: Passive, type: MyComp });
    const rootFiber = makeFiber({
      subtreeFlags: Passive,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withPassiveEffects).toHaveLength(1);
    expect(result.withPassiveEffects[0].type).toBe(MyComp);
    expect(result.withPassiveEffects[0].tag).toBe(FunctionComponent);
    // ownerName is the nearest component ancestor, not self
    expect(result.withPassiveEffects[0].ownerName).toBe('MockComponent');
  });

  test('collects fibers with LayoutMask flags', () => {
    const child = makeFiber({ flags: LayoutMask });
    const rootFiber = makeFiber({
      subtreeFlags: LayoutMask,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withLayoutEffects).toHaveLength(1);
  });

  test('collects Suspense fibers with DidCapture', () => {
    const child = makeFiber({
      tag: SuspenseComponent,
      flags: DidCapture,
    });
    const rootFiber = makeFiber({
      subtreeFlags: DidCapture,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withSuspense).toHaveLength(1);
    expect(result.withSuspense[0].tag).toBe(SuspenseComponent);
  });

  test('does not collect Suspense fibers without DidCapture or resolved Offscreen', () => {
    const child = makeFiber({
      tag: SuspenseComponent,
      flags: 0,
    });
    const rootFiber = makeFiber({ child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withSuspense).toHaveLength(0);
  });

  test('collects Suspense with resolved Offscreen child (Visibility flag)', () => {
    const LazyDashboard = function LazyDashboard() {};
    const resolvedChild = makeFiber({ type: LazyDashboard, flags: 1 }); // Placement
    const offscreen = makeFiber({
      tag: OffscreenComponent,
      flags: Visibility,
      type: null,
      child: resolvedChild,
    });
    const suspense = makeFiber({
      tag: SuspenseComponent,
      flags: 0, // DidCapture already cleared
      subtreeFlags: Visibility,
      child: offscreen,
    });
    const parentComp = function MyPage() {};
    const parent = makeFiber({
      type: parentComp,
      subtreeFlags: Visibility,
      child: suspense,
    });
    const rootFiber = makeFiber({
      subtreeFlags: Visibility,
      child: parent,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withSuspense).toHaveLength(1);
    // ownerName is nearest component ancestor
    expect(result.withSuspense[0].ownerName).toBe('MyPage');
    // resolvedName comes from offscreen's child, but offscreen type is null
    expect(result.withSuspense[0].resolvedName).toBeNull();
  });

  test('collects fibers with non-zero lanes', () => {
    const child = makeFiber({ lanes: 1 });
    const rootFiber = makeFiber({
      childLanes: 1,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    // Both root and child have non-zero lanes/childLanes
    expect(result.withUpdates).toHaveLength(2);
    expect(result.withUpdates[1].lanes).toBe(1);
  });

  test('traverses siblings', () => {
    const CompA = function CompA() {};
    const CompB = function CompB() {};
    const sibling = makeFiber({ flags: Passive, type: CompB });
    const child = makeFiber({ flags: Passive, type: CompA, sibling });
    const rootFiber = makeFiber({
      subtreeFlags: Passive,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withPassiveEffects).toHaveLength(2);
    expect(result.withPassiveEffects[0].type).toBe(CompA);
    // ownerName is the parent (MockComponent), not self
    expect(result.withPassiveEffects[0].ownerName).toBe('MockComponent');
    expect(result.withPassiveEffects[1].type).toBe(CompB);
    expect(result.withPassiveEffects[1].ownerName).toBe('MockComponent');
  });

  test('excludes host fibers from withLayoutEffects (only component fibers)', () => {
    const MyComp = function MyComp() {};
    // Host element (tag 5) with LayoutMask — should be excluded
    const hostChild = makeFiber({ tag: 5, flags: LayoutMask, type: 'button' });
    // Component fiber (tag 0) with LayoutMask — should be included
    const compFiber = makeFiber({
      type: MyComp,
      flags: LayoutMask,
      subtreeFlags: LayoutMask,
      child: hostChild,
    });
    const rootFiber = makeFiber({
      subtreeFlags: LayoutMask,
      child: compFiber,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    // Only the component fiber should be in withLayoutEffects
    expect(result.withLayoutEffects).toHaveLength(1);
    expect(result.withLayoutEffects[0].tag).toBe(0);
    expect(result.withLayoutEffects[0].ownerName).toBe('MockComponent');
  });

  test('reads __componentId from fiber.type when present', () => {
    const MyComp = function MyComp() {} as { __componentId?: string };
    MyComp.__componentId = 'src/MyComp.tsx:15';
    const child = makeFiber({ flags: Passive, type: MyComp });
    const rootFiber = makeFiber({
      subtreeFlags: Passive,
      child,
    });
    const result = snapshotCommitFibers(makeRoot(rootFiber));
    expect(result.withPassiveEffects[0].componentId).toBe('src/MyComp.tsx:15');
  });

  test('handles null root.current gracefully', () => {
    const result = snapshotCommitFibers({ current: null } as unknown as FiberRoot);
    expect(result.withPassiveEffects).toEqual([]);
  });

  test('extracts _debugSource from fibers with LayoutMask', () => {
    const MyComp = function MyComp() {};
    const child = makeFiber({
      flags: LayoutMask,
      type: MyComp,
      _debugSource: {
        fileName: 'src/MyComp.tsx',
        lineNumber: 15,
        columnNumber: 4,
      },
    });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].source).toEqual({
      fileName: 'src/MyComp.tsx',
      lineNumber: 15,
      columnNumber: 4,
    });
  });

  test('source is null when _debugSource is absent (production build)', () => {
    const child = makeFiber({ flags: LayoutMask });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].source).toBeNull();
  });

  test('builds componentStack from _debugOwner chain', () => {
    const App = function App() {};
    const Page = function Page() {};
    const MyComp = function MyComp() {};

    const appFiber = makeFiber({ type: App });
    const pageFiber = makeFiber({ type: Page, _debugOwner: appFiber });
    const child = makeFiber({
      flags: LayoutMask,
      type: MyComp,
      _debugOwner: pageFiber,
    });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].componentStack).toEqual([
      'Page',
      'App',
    ]);
  });

  test('componentStack is null when _debugOwner is absent', () => {
    const child = makeFiber({ flags: LayoutMask });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].componentStack).toBeNull();
  });

  test('extracts effectSource from layout effect in updateQueue', () => {
    const effectCreate = () => {
      /* setState(count * 2); */
    };
    const layoutEffect: Effect = {
      tag: 0b0101, // HasEffect | Layout
      create: effectCreate,
      next: null as unknown as Effect,
    };
    // Circular linked list — single effect points to itself
    layoutEffect.next = layoutEffect;

    const child = makeFiber({
      flags: LayoutMask,
      updateQueue: { lastEffect: layoutEffect },
    });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].effectSource).toBe(
      effectCreate.toString()
    );
  });

  test('effectSource is null when updateQueue is absent', () => {
    const child = makeFiber({ flags: LayoutMask });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].effectSource).toBeNull();
  });

  test('picks first layout effect when multiple effects exist', () => {
    const layoutCreate = () => {
      /* setAdjusted(1); */
    };
    const passiveCreate = () => {
      /* console.log('passive'); */
    };
    const layoutEffect: Effect = {
      tag: 0b0101,
      create: layoutCreate,
      next: null as unknown as Effect,
    };
    const passiveEffect: Effect = {
      tag: 0b1001,
      create: passiveCreate,
      next: null as unknown as Effect,
    };
    // Circular: passive -> layout -> passive
    passiveEffect.next = layoutEffect;
    layoutEffect.next = passiveEffect;

    const child = makeFiber({
      flags: LayoutMask,
      updateQueue: { lastEffect: passiveEffect },
    });
    const rootFiber = makeFiber({ subtreeFlags: LayoutMask, child });
    const result = snapshotCommitFibers(makeRoot(rootFiber));

    expect(result.withLayoutEffects[0].effectSource).toBe(
      layoutCreate.toString()
    );
  });
});

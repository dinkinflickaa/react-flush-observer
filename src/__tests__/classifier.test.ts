import { classifyPattern } from '../classifier';
import { SuspenseComponent, FunctionComponent } from '../constants';
import type { FiberSnapshot } from '../types';

describe('classifyPattern', () => {
  test('returns lazy-in-render when Suspense fibers present', () => {
    const fibers: FiberSnapshot = {
      withPassiveEffects: [],
      withLayoutEffects: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function X() {},
          ownerName: null,
          source: null,
          componentStack: null,
          effectSource: null,
        },
      ],
      withSuspense: [
        {
          componentId: null,
          tag: SuspenseComponent,
          type: null,
          ownerName: null,
          resolvedName: null,
        },
      ],
      withUpdates: [],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('lazy-in-render');
    expect(result.suspects).toBe(fibers.withSuspense);
    expect(result.evidence).toMatch(/Suspense/);
  });

  test('returns setState-in-layout-effect when layout effects present but no Suspense', () => {
    const fibers: FiberSnapshot = {
      withPassiveEffects: [],
      withLayoutEffects: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function Y() {},
          ownerName: null,
          source: null,
          componentStack: null,
          effectSource: null,
        },
      ],
      withSuspense: [],
      withUpdates: [],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-in-layout-effect');
    expect(result.suspects).toBe(fibers.withLayoutEffects);
    expect(result.evidence).toMatch(/Layout effect/);
  });

  test('returns setState-outside-react as fallback', () => {
    const fibers: FiberSnapshot = {
      withPassiveEffects: [],
      withLayoutEffects: [],
      withSuspense: [],
      withUpdates: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function Z() {},
          ownerName: null,
          lanes: 1,
        },
      ],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-outside-react');
    expect(result.suspects).toBe(fibers.withUpdates);
    expect(result.evidence).toMatch(/batching/i);
  });

  test('lazy-in-render takes priority over layout effects', () => {
    const fibers: FiberSnapshot = {
      withPassiveEffects: [],
      withLayoutEffects: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function A() {},
          ownerName: null,
          source: null,
          componentStack: null,
          effectSource: null,
        },
      ],
      withSuspense: [
        {
          componentId: null,
          tag: SuspenseComponent,
          type: null,
          ownerName: null,
          resolvedName: null,
        },
      ],
      withUpdates: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function B() {},
          ownerName: null,
          lanes: 1,
        },
      ],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('lazy-in-render');
  });

  test('setState-in-layout-effect takes priority over setState-outside-react', () => {
    const fibers: FiberSnapshot = {
      withPassiveEffects: [],
      withLayoutEffects: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function C() {},
          ownerName: null,
          source: null,
          componentStack: null,
          effectSource: null,
        },
      ],
      withSuspense: [],
      withUpdates: [
        {
          componentId: null,
          tag: FunctionComponent,
          type: function D() {},
          ownerName: null,
          lanes: 1,
        },
      ],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-in-layout-effect');
  });
});

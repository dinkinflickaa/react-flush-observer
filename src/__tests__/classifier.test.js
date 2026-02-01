const { classifyPattern } = require('../classifier');
const { SuspenseComponent, FunctionComponent } = require('../constants');

describe('classifyPattern', () => {
  test('returns lazy-in-render when Suspense fibers present', () => {
    const fibers = {
      withPassiveEffects: [],
      withLayoutEffects: [{ componentId: null, tag: FunctionComponent, type: function X() {} }],
      withSuspense: [{ componentId: null, tag: SuspenseComponent, type: null }],
      withUpdates: [],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('lazy-in-render');
    expect(result.suspects).toBe(fibers.withSuspense);
    expect(result.evidence).toMatch(/Suspense/);
  });

  test('returns setState-in-layout-effect when layout effects present but no Suspense', () => {
    const fibers = {
      withPassiveEffects: [],
      withLayoutEffects: [{ componentId: null, tag: FunctionComponent, type: function Y() {} }],
      withSuspense: [],
      withUpdates: [],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-in-layout-effect');
    expect(result.suspects).toBe(fibers.withLayoutEffects);
    expect(result.evidence).toMatch(/layout effect/);
  });

  test('returns setState-outside-react as fallback', () => {
    const fibers = {
      withPassiveEffects: [],
      withLayoutEffects: [],
      withSuspense: [],
      withUpdates: [{ componentId: null, tag: FunctionComponent, type: function Z() {}, lanes: 1 }],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-outside-react');
    expect(result.suspects).toBe(fibers.withUpdates);
    expect(result.evidence).toMatch(/unbatched/i);
  });

  test('lazy-in-render takes priority over layout effects', () => {
    const fibers = {
      withPassiveEffects: [],
      withLayoutEffects: [{ componentId: null, tag: FunctionComponent, type: function A() {} }],
      withSuspense: [{ componentId: null, tag: SuspenseComponent, type: null }],
      withUpdates: [{ componentId: null, tag: FunctionComponent, type: function B() {}, lanes: 1 }],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('lazy-in-render');
  });

  test('setState-in-layout-effect takes priority over setState-outside-react', () => {
    const fibers = {
      withPassiveEffects: [],
      withLayoutEffects: [{ componentId: null, tag: FunctionComponent, type: function C() {} }],
      withSuspense: [],
      withUpdates: [{ componentId: null, tag: FunctionComponent, type: function D() {}, lanes: 1 }],
    };
    const result = classifyPattern(fibers);
    expect(result.pattern).toBe('setState-in-layout-effect');
  });
});

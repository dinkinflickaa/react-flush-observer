const {
  FunctionComponent,
  ClassComponent,
  SuspenseComponent,
  OffscreenComponent,
  Placement,
  Passive,
  Update,
  LayoutMask,
  DidCapture,
  Visibility,
} = require('../constants');

describe('constants', () => {
  test('fiber tags are correct numeric values', () => {
    expect(FunctionComponent).toBe(0);
    expect(ClassComponent).toBe(1);
    expect(SuspenseComponent).toBe(13);
    expect(OffscreenComponent).toBe(22);
  });

  test('Passive flag is a single bit', () => {
    expect(Passive).toBe(0b00000000000000100000000000);
    // Verify it's a power of 2 (single bit)
    expect(Passive & (Passive - 1)).toBe(0);
  });

  test('Update flag value', () => {
    expect(Update).toBe(0b00000000000000000000000100);
  });

  test('LayoutMask includes Update bit', () => {
    expect(LayoutMask & Update).toBe(Update);
  });

  test('DidCapture flag value', () => {
    expect(DidCapture).toBe(0b00000000000000010000000000);
  });

  test('Placement flag value', () => {
    expect(Placement).toBe(1);
  });

  test('Visibility flag value', () => {
    expect(Visibility).toBe(8192);
  });

  test('flags do not overlap unexpectedly', () => {
    // Passive and LayoutMask should not overlap
    expect(Passive & LayoutMask).toBe(0);
    // Passive and DidCapture should not overlap
    expect(Passive & DidCapture).toBe(0);
    // Visibility should not overlap with LayoutMask or DidCapture
    expect(Visibility & LayoutMask).toBe(0);
    expect(Visibility & DidCapture).toBe(0);
  });
});

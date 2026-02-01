// Fiber tags (React's WorkTag enum — stable across dev/prod)
const FunctionComponent    = 0;
const ClassComponent       = 1;
const SuspenseComponent    = 13;
const OffscreenComponent   = 22;

// Fiber flags (bitmask on fiber.flags — stable across dev/prod)
const Placement  = 0b00000000000000000000000001;  // 1
const Passive    = 0b00000000000000100000000000;  // 2048
const Update     = 0b00000000000000000000000100;  // 4
const LayoutMask = 0b00000000000000000000100100;  // 36
const DidCapture = 0b00000000000000010000000000;  // 1024
const Visibility = 0b00000000000010000000000000;  // 8192

module.exports = {
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
};

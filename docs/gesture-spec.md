# Gesture Spec

- Input events from the vision layer:
  - `pointer.observed`: normalized pointer coordinates from the active hand
  - `gesture.intent`: semantic gesture signals like `primary-pinch`, `thumb-middle-pinch`, and `open-palm-hold`
  - `status`: live debugging state used by the calibration UI, including camera and Leap runtime fields
- Action events inside the desktop layer:
  - `pointer.move`: screen-space cursor move
  - `pointer.down` / `pointer.up`: press state for drag support, with click-vs-drag decided by the desktop mapper's hold threshold
  - `click`: discrete click action, including right click from the thumb-middle pinch gesture
  - `key.tap`: mapped keyboard action such as `Return`
- Calibration/debug view:
  - shows live primary pinch hold time
  - shows whether the mapper currently predicts `click` or `drag`
  - shows webcam frame metrics or Leap pointer/clutch diagnostics depending on the active backend

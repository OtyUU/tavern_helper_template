<tasks>

# WAAPI Camera Transitions Migration — v2.0 (Safer + Clearer)

This version fixes the two main hazards in v1:
1) **TransitionBus leak risk** when `animateCameraLayerWAAPI()` returns early (or throws) before `bus.register()` exists.
2) The tracker rename conflict (camera WAAPI + sprite CSS tracking share the same structure). v2 uses a neutral name.

---

## Guiding Rules (must-haves)

- **No intent-level gating** (`cameraSig`, preset compare, etc.). The **only ground-truth gate** is comparing actual computed transforms (`fromTransform === toTransform`).
- **No reveal gap:** if animations are started in `nextTick`, you must hold the phase FSM with a **preliminary bus lock** registered synchronously.
- **Bus registration must be safe with early-return:** the bus entry must exist *before* `onDone` can be called.
- **Cleanup is idempotent** and must fire on: finish, cancel, exception, early-return, and fallback timeout.

---

## Phase 1 — Core WAAPI function + tracker rename **done**

### Task 1.1: Implement `animateCameraLayerWAAPI()`
- [x] 1.1.1 Add `animateCameraLayerWAAPI()` in `player-composables.ts` (same file as `useScenePresentation`).
- [x] 1.1.2 Signature:
  ```ts
  function animateCameraLayerWAAPI(
    element: HTMLElement,
    fromTransform: string,
    toTransform: string,
    durationMs: number,
    onDone?: () => void,
  ): () => void
  ```
- [x] 1.1.3 **Do not** call `bus.register()` inside this function. Caller owns TransitionBus.
- [x] 1.1.4 Normalize trivial variants before comparisons:
  - treat `''` as `'none'`
  - `const from = fromTransform?.trim() || 'none'`, same for `to`
- [x] 1.1.5 Early-return gates (both MUST call `onDone?.()` and return a no-op cleanup):
  - `durationMs <= 0`
  - `from === to`  ← **primary gate**
- [x] 1.1.6 Rename `activeCssTransitionTrackers` → **`activeMotionTrackers`**
  - Type stays: `WeakMap<HTMLElement, Map<string, () => void>>`
  - Rationale: this map will now track **both** WAAPI camera motion and CSS-tracked sprite motion, so "camera" naming is misleading.
- [x] 1.1.7 Cancel any prior tracked motion on same element/property before starting:
  ```ts
  const perProp = getOrCreateMap(activeMotionTrackers, element);
  perProp.get('transform')?.(); // cancels prior motion + calls its onDone
  ```
- [x] 1.1.8 Start WAAPI animation:
  ```ts
  const animation = element.animate(
    [{ transform: from }, { transform: to }],
    { duration: durationMs, easing: 'ease', fill: 'none' },
  );
  ```
- [x] 1.1.9 Store cleanup in `activeMotionTrackers` under `'transform'` so a later call cancels it.
- [x] 1.1.10 Cleanup must:
  - be **idempotent** (`if (finished) return`)
  - clear fallback timeout
  - remove listeners
  - cancel animation (inside try/catch)
  - remove itself from `activeMotionTrackers` if still current
  - call `onDone?.()` exactly once
- [x] 1.1.11 Hook both events:
  - `animation.addEventListener('finish', cleanup, { once: true })`
  - `animation.addEventListener('cancel', cleanup, { once: true })`
- [x] 1.1.12 Fallback timeout: `durationMs + 50` calls cleanup.
- [x] 1.1.13 Return the cleanup function.

### Task 1.2: Keep sprite CSS transition tracking working
- [x] 1.2.1 Update `trackCssTransition()` to use `activeMotionTrackers` (renamed only; behavior unchanged).
- [x] 1.2.2 Ensure sprite position transition tracking remains identical (still CSS `transitionend`/fallback based).

**Acceptance Criteria (Phase 1)**
- `from === to` and `durationMs <= 0` return immediately, invoke `onDone`, and do not leave tracker entries behind.
- Starting a new WAAPI camera animation cancels any prior camera animation on that element.
- Cleanup runs on finish/cancel/timeout/exception and removes tracker entry.

---

## Phase 2 — FLIP-based camera transform tracking + safe TransitionBus integration **done**

### Task 2.1: Rewrite `trackCameraTransformTransition()` to use WAAPI (FLIP)
Replace the current CSS transition tracking for camera layers with this FLIP pattern.

**Preconditions / invariants**
- Called only after `applyDisplayedFrame(next)` (already true in current code).
- Must NOT rely on `cameraSig()` or preset comparisons to decide whether animation occurs.

#### 2.1.1 Early returns (sync)
- [x] 2.1.1 Return if `effectsDisabled.value === true`
- [x] 2.1.2 Return if `prefersReducedMotion.value === true`
- [x] 2.1.3 Return if `cameraTransitionMs.value <= 0`

#### 2.1.2 Capture “from” synchronously (pre-flush)
- [x] 2.1.4 Capture each element independently; do not let `null` on one skip the other:
  ```ts
  const bgEl = backgroundCameraElement.value;
  const spriteEl = spriteCameraElement.value;

  const fromBg = bgEl ? getComputedStyle(bgEl).transform : null;
  const fromSprite = spriteEl ? getComputedStyle(spriteEl).transform : null;
  ```
- [x] 2.1.5 If both elements are `null`, return (avoid pointless bus lock).

#### 2.1.3 Register ONE preliminary bus lock (sync)
- [x] 2.1.6 Create a `finished` flag for the pre-nextTick window.
- [x] 2.1.7 Register preliminary lock synchronously:
  ```ts
  let finished = false;
  const unlockPrelim = bus.register(() => { finished = true; });
  ```
  This prevents `scene → reveal` from occurring between “from” capture and nextTick animation registration.

#### 2.1.4 In `nextTick()`: capture “to” (post-flush) and start WAAPI
- [x] 2.1.8 Schedule `nextTick(() => { ... })`
- [x] 2.1.9 Inside nextTick: if `finished` is true, call `unlockPrelim()` and return.
- [x] 2.1.10 Inside nextTick: re-check gating (because settings can change during the tick):
  - if `effectsDisabled` or `prefersReducedMotion` or `cameraTransitionMs <= 0`, call `unlockPrelim()` and return.
- [x] 2.1.11 Inside nextTick: null-guard each element again (component could unmount):
  ```ts
  const bgEl2 = backgroundCameraElement.value;
  const spriteEl2 = spriteCameraElement.value;
  ```
- [x] 2.1.12 Capture “to”:
  ```ts
  const toBg = bgEl2 ? getComputedStyle(bgEl2).transform : null;
  const toSprite = spriteEl2 ? getComputedStyle(spriteEl2).transform : null;
  ```

#### 2.1.5 CRITICAL: Safe bus integration pattern (bus-first)
For each element (bg and sprite) independently, if both `fromX` and `toX` are non-null:

- [x] 2.1.13 If `from === to`, do nothing for that element (optional optimization; WAAPI still has the internal gate).
- [x] 2.1.14 Otherwise start WAAPI using **bus-first registration** so early-return cannot leak:
  ```ts
  let waapiCleanup: (() => void) | null = null;

  const cancel = () => { waapiCleanup?.(); };  // stable identity for TransitionBus
  const deregister = bus.register(cancel);

  waapiCleanup = animateCameraLayerWAAPI(el, from, to, cameraTransitionMs.value, () => {
    deregister();
  });
  ```
  Notes:
  - `cancelAll()` calls `cancel()`; `cancel()` calls `waapiCleanup()` once it exists.
  - If `animateCameraLayerWAAPI()` early-returns and synchronously calls `onDone`, the bus entry **already exists** and will be deregistered safely.

- [x] 2.1.15 After attempting both elements, call `unlockPrelim()`.

### Task 2.2: Optional (recommended): cancel camera WAAPI on reduced-motion toggle
This makes Phase 4.2.2 deterministic (“toggle reduced motion during animation” stops motion promptly).

- [x] 2.2.1 Add a watcher inside `useScenePresentation`:
  - When `prefersReducedMotion.value` becomes true (or `effectsDisabled` becomes true), cancel active camera-layer transform motions by calling the per-element tracker cleanup:
    ```ts
    activeMotionTrackers.get(backgroundCameraElement.value)?.get('transform')?.();
    activeMotionTrackers.get(spriteCameraElement.value)?.get('transform')?.();
    ```
  - (Do not cancel sprite shell transitions unless you intentionally want a global cancel.)

**Acceptance Criteria (Phase 2)**
- No `cameraSig()` usage or preset compare gating.
- FLIP is correct: “from” captured pre-flush, “to” captured post-flush.
- Preliminary bus lock prevents FSM advance during the tick gap.
- Each layer (bg and sprite) animates independently.
- No TransitionBus leaks when transforms match or duration is 0.
- Mid-animation camera change cancels prior WAAPI cleanly and starts the new one.

---

## Phase 3 — Remove CSS transform transitions for camera layers **done**

### Task 3.1: Remove `transition` from `backgroundCameraStyle`
- [x] 3.1.1 In `useRenpyPlayerController.ts`, remove `transition` from `backgroundCameraStyle`.
- [x] 3.1.2 Keep `transform` and `transformOrigin`.
- [x] 3.1.3 Update comment: “Camera motion is animated via WAAPI in useScenePresentation (imperative).”

### Task 3.2: Remove `transition` from `spriteCameraStyle`
- [x] 3.2.1 In `useRenpyPlayerController.ts`, remove `transition` from `spriteCameraStyle`.
- [x] 3.2.2 Keep `transform` and `transformOrigin`.
- [x] 3.2.3 Update comment similarly.

### Task 3.3: Ensure no CSS rules reintroduce transform transitions
- [x] 3.3.1 Search SCSS for `transition: transform` affecting `.renpy-player__camera-layer*`.
- [x] 3.3.2 Remove/adjust any such rules (WAAPI is now the only animation path for camera transforms).

### Task 3.4: Keep `resolvedCameraTransitionMs`
- [x] 3.4.1 Keep it for:
  - WAAPI duration source
  - `cameraLayerAnimatingClass` / `will-change: transform` behavior
- [x] 3.4.2 Update comment: “Used for WAAPI duration + will-change toggling (not CSS transition).”

---

## Phase 4 — Manual Testing (updated expectations)

### Task 4.1: Basic transitions
- [ ] default → closeup
- [ ] closeup → medium
- [ ] medium → default
- [ ] Verify ease curve + no jitter (Firefox focus)

### Task 4.2: Edge cases
- [ ] Mid-animation camera change: old cancels, new continues smoothly
- [ ] Toggle reduced motion during animation:
  - If Task 2.2 implemented: animation stops promptly
  - Otherwise: document “affects future only”
- [ ] Rapid camera changes (spam)
- [ ] `cameraTransitionMs = 0` (no blocking; immediate reveal)
- [ ] Initial render (elements null): no errors, no bus lock leak
- [ ] During scene crossfade: camera WAAPI should not run (already gated by call site + checks)
- [ ] CRITICAL: auto-pan changes when sprites reposition still animate (no intent gating)
- [ ] CRITICAL: same preset but pan changes animate (covered because we use computed transform deltas)

### Task 4.3: Phase FSM correctness
- [ ] With `cameraTransitionMs = 1000`, confirm phase stays `scene` until WAAPI completes
- [ ] Confirm `bus.count` increments and returns to 0 on completion/cancel/timeout
- [ ] Confirm dialogue reveal starts only after bus reaches 0

### Task 4.4: Memory/leak sanity
- [ ] Perform 50+ camera transitions
- [ ] Ensure WeakMap does not retain detached elements (no strong refs)
- [ ] Ensure per-element perProp map entries are removed on cleanup

---

## Phase 5 — Docs + cleanup

### Task 5.1: Comments / JSDoc updates
- [ ] Add JSDoc to `animateCameraLayerWAAPI()`:
  - why `fill:'none'`
  - why `ease` is safe in WAAPI (compositor path)
  - guarantees about calling `onDone`
- [ ] Add JSDoc to `trackCameraTransformTransition()`:
  - FLIP timing
  - preliminary bus lock rationale
  - explicitly: “no cameraSig gating”

### Task 5.2: Update `FIREFOX_SPRITE_JITTER_FIX.md`
- [ ] Add section: camera transitions migrated from CSS to WAAPI
- [ ] Explain why WAAPI `ease` is safe vs CSS nested-transform `ease` jitter
- [ ] Add note: seeing `ease` in WAAPI does not contradict earlier CSS findings

### Task 5.3: Repo hygiene
- [ ] Ensure no remaining references to `activeCssTransitionTrackers`
- [ ] TypeScript + lint clean
- [ ] Remove dead code (camera CSS tracking path)

</tasks>

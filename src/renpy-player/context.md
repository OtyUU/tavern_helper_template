# Ren'Py Player Context

Agent-facing context for `src/renpy-player`. Covers architecture, invariants, and traps — things that span multiple files or would cause bugs if missed. For implementation details, read the relevant source file directly.

## Purpose

Renders a Ren'Py-like VN viewport inside the SillyTavern chat UI from LLM-produced text. The **chat** is the interaction surface; the **viewport** visualizes parsed scene + dialogue frames for the selected message.

## Data Pipeline

Five steps, spanning four files — this is the core mental model:

1. **Parse** — `parseScriptFromMessage(message)` → flat `ScriptCommand[]` list.
2. **Replay history** — `getInitialState()` feeds all prior messages through `StageState` to produce the visual starting point for the current message. This is stateless — same inputs always produce same outputs.
3. **Build frames** — `buildFrames(parsed, { initialState })` runs commands through `StageState`, emitting one `PlayerFrame` per `dialogue` command. Frames are plain snapshots with no behavior attached.
4. **Select** — The cursor (`activeMessageId` + `frameIndex`) picks one frame → `currentFrame`.
5. **Present** — `watch(currentFrame)` triggers `applyFrame()` in `useScenePresentation`, which updates `displayed*` refs that Vue renders.

## The displayed/current Split

`SceneLayer` and camera computeds read from `displayedBackground`, `displayedSprites`, `displayedCamera` (`PlayerCameraIntent`), and `displayedCameraAnimations` — not from `currentFrame`. During a scene crossfade, these refs update at deliberate moments (background/camera at midpoint, sprites at the end). `applyDisplayedFrame()` only writes to `displayedBackground` and `displayedCamera` when their values actually change (compared by content, not reference), which prevents spurious WAAPI from/to captures. **Any new visual presentation code must read from `displayed*` refs, never from `currentFrame` directly.**

## Runtime Environment

- **Script module, not an iframe.** `index.ts` mounts Vue apps directly onto the SillyTavern host page via jQuery. No `index.html`.
- **Style teleportation.** Compiled styles don't reach the host page from the background iframe. `teleportStyle()` copies them. Use unscoped SCSS with BEM `renpy-player__` classes — **no Tailwind** (class collisions with SillyTavern), no `:deep()`.
- **DOM re-anchoring.** The player host (`#th-renpy-player`) must be re-inserted on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED` because SillyTavern rebuilds the chat DOM.
- **Swipes.** Swiping does not change `message_id` — same message, new swipe text.
- **Lifecycle.** Init in `$(() => { ... })`. Cleanup via `$(window).on('pagehide', ...)`.
- **Auto-imports.** Vue Composition API, Zod (`z`), VueUse, and Pinia are auto-imported. Check `auto-imports.d.ts` for the full list. Options API is disabled; always use `<script setup lang="ts">`.
- **Tavern Helper API.** `getChatMessages`, `eventOn`, `getVariables`, `insertOrAssignVariables`, etc. See the Tavern Helper docs referenced in `CLAUDE.md` for signatures and event types.

## Architectural Invariants

### Stateless Parser + History Replay

The parser has no persistent state. Statefulness comes from replaying history on every recompute:

1. Fetch messages 0 through N-1, run each through `parseScriptFromMessage`, feed into a temporary `StageState`.
2. `flush()` produces `InitialPlayerState` — the visual context at message N's start.
3. Pass as `initialState` into `buildFrames()`.

This means editing any earlier message automatically propagates forward on the next `historyTrigger` bump. The parser **must** remain truly stateless — no module-level mutable state, no caches that outlive a single call. Side effects would produce different results depending on call order, breaking the replay guarantee.

**`historyTrigger`** is the reactive bridge. `getChatMessages()` is not reactive, so any computed that calls it must read `historyTrigger.value` first.

### Phase FSM

Three phases govern frame playback: `scene → reveal → done`. Every frame advance resets to `scene`.

- **`scene`**: Visual animations are settling. `useTransitionBus` tracks in-flight transitions via a reactive `count`. When `bus.count === 0` (and `blockReveal` is false), the FSM advances to `reveal`. In instant/reduced-motion mode, this fires immediately.
- **`reveal`**: `beginReveal()` starts the typewriter effect. Stage clicks skip to fully revealed text.
- **`done`**: Ready to advance. Stage clicks move to the next frame; autoplay proceeds after its delay.

To register a new animation with the bus: call `bus.register(cancelFn)` **synchronously** before the animation begins, and call the returned cleanup when it finishes. Cleanup must be idempotent.

**Current bus registrations (what blocks `scene → reveal`):**

- ✅ Scene crossfade (full-screen fade, timeout-based, registered in `useScenePresentation.applyFrame`)
- ✅ Sprite enter/leave visibility fades (WAAPI-based, registered in `useSpriteVisibilityTransitions` TransitionGroup hooks)
- ✅ Camera transform WAAPI animations (registered in `useScenePresentation.trackCameraTransformTransition` when camera preset/pan changes)
- ✅ Sprite motion WAAPI animations (registered in `useScenePresentation.trackSpritePositionTransitions` on `.renpy-player__sprite-motion`)
- ✅ SmartImage swaps (timeout-based, registered in `controller.onSmartImageSwapStart` when `@swap-start` fires during `phase === 'scene'`)
- ✅ Camera shake animation (fixed 450ms timeout, registered via watcher on `cameraAnimationClass` in controller)

**Intentionally NOT registered (does not block reveal):**

- ❌ Sprite keyframe animations (shake/bounce/pulse) — cosmetic, should not delay dialogue
- ❌ HUD show/hide animations (handled separately via `hudShowInProgress` / `blockReveal`)
- ❌ Dialogue text reveal itself (that's what the bus is blocking)
- ❌ CSS transitions caused by settings/geometry changes (not tied to frame presentation)

**Firefox note:** Camera and sprite motion WAAPI uses UA-sniffed easing: Firefox gets `cubic-bezier(0.2, 0.1, 0.8, 0.9)` (near-linear tails to avoid visible resampling shimmer), other browsers get standard `ease`. This avoids the "near-stationary" tail shimmer that `ease` triggers in Firefox while preserving smooth motion elsewhere.

**Important policy:** Only animations that affect staging or readability should block reveal. If registration is deferred (e.g., inside `requestAnimationFrame` or waiting for an image to load), the FSM can see `count === 0` during the gap and prematurely advance to `reveal`. Unregistered animations will not block phase transitions.

### Settings Mutation

`updateSettings(draft => { ... })` is the **only** way controller code mutates settings. It clones via `klona()`, runs the updater, then assigns back. Never assign `settings.value.x = ...` directly. More broadly, `klona()` is mandatory before any `insertOrAssignVariables()` call or any Tavern Helper API receiving a reactive value.

### Sync Tiers

- **`fullSync(options?)`** — Heavy: rebuilds playable index, bumps `historyTrigger`, resolves message IDs. Used for `CHAT_CHANGED`, `MESSAGE_DELETED`, `MORE_MESSAGES_LOADED`, initial mount.
- **`refreshCurrentMessageOnly()`** — Light: bumps `historyTrigger` only. Used for in-place edits/swipes of the current message.

### Generation Lock

Prevents the viewport from showing a half-generated message:

1. `GENERATION_STARTED` predicts the target message ID, adds it to `excludedPlayableMessageIds`, and jumps the viewport to a safe prior frame.
2. First `MESSAGE_UPDATED` during generation confirms (or retargets) the lock. Subsequent updates for the locked target are ignored to avoid parse churn.
3. `GENERATION_ENDED` / `GENERATION_STOPPED` clears exclusions and rebuilds the playable index.

### Motion Mode

- `'instant'` — set by backward navigation, manual message jumps, and safe-frame jumps. Zeroes all transition durations.
- `'normal'` — set by forward navigation and cross-message forward jumps.
- `effectsDisabled = prefersReducedMotion || motionMode === 'instant'` — governs whether animations play.

### Two-Layer Camera Architecture

Camera pan + zoom is applied to two sibling `renpy-player__camera-layer` divs in `SceneLayer.vue`, not to individual sprites or the background element. Each layer gets its own computed style (`backgroundCameraStyle` / `spriteCameraStyle`) combining scale + translate.

- **Preset-driven zoom.** Presets provide both `backgroundScale` and `spriteScale` (sprites can zoom differently than background). Background zoom can also apply a parallax factor (`bgZoomParallax`) to reduce perceived background zoom relative to sprites.
- **Parallax.** `bgPanParallax` (0–1) multiplies the pan offset on the background camera layer. At 1.0 the background pans identically to sprites; below 1.0 it moves less (parallax effect).
- **WAAPI transitions.** Camera and sprite motion are animated with WAAPI via `animateCameraLayerWAAPI()` in `useScenePresentation`. Uses a FLIP pattern where "from" is captured from `prevBackgroundTransform`/`prevSpriteTransform` refs (not `getComputedStyle`), and "to" is read from `style.transform` in `nextTick`. A `sharedTransformStartTime` synchronizes start time across bg/sprite cameras and sprite motions for perfect alignment. Duration is effectively zeroed when `effectsDisabled`, `prefersReducedMotion`, `isSceneTransitioning`, or `cameraTransitionMs <= 0`. CSS transitions are not used for transforms. WAAPI uses `fill: 'both'` (cleanup always `cancel()`s, reverting to Vue's inline `style.transform`).
- **Firefox shimmer mitigation.** Firefox can show visible wobble when animating eased scale+translate transforms. A UA-sniffed custom cubic-bezier replaces `ease` on Firefox (see Firefox note in Phase FSM section).
- **Pixel-based sprite shells.** Sprite horizontal position is `transform: translate3d(xPx, 0, 0) translateX(-50%)` computed via `stageWidth`, not a `left: %`. This is because camera-layer `scale()` would distort percentage-based `left` positions.
- **`PlayerCameraIntent`** (types.ts) carries `preset`, `panXPct?`, `panYPct?` — no pixel values, safe to persist through history replay. `normalizeCameraFromFrame()` in `camera-utils.ts` migrates legacy `cameraTransform` frames.
- **Automatic horizontal pan.** When `panXPct` is undefined in `PlayerCameraIntent`, the camera automatically centers all visible sprites. `autoPanXPct` computes the center point between the leftmost and rightmost sprites, then calculates the pan offset needed to center that point on stage. Manual `panXPct` values (when implemented in parser) override this behavior.
- **Transition tracking.** `useScenePresentation` tracks WAAPI `transform` animations on both camera layer elements and sprite motion elements via a shared `activeCameraAnimationTrackers` WeakMap. The same `animateCameraLayerWAAPI()` function handles both camera and sprite motion WAAPI.

### Sprite Transform Stack (Wrappers)

Sprites are rendered with a wrapper stack to avoid split-axis transforms, preserve keyframe effect semantics, and allow WAAPI motion tracking:

- `.renpy-player__sprite-shell` — TransitionGroup enter/leave target; owns opacity fades (WAAPI in `useSpriteVisibilityTransitions`).
- `.renpy-player__sprite-fx` — hosts CSS keyframe effects that translate (shake/bounce). Not bus-tracked.
- `.renpy-player__sprite-motion` — owns the *base positional transform* (anchor X + baseline Y). Sprite position changes are WAAPI-animated here and bus-tracked (`trackSpritePositionTransitions`). Uses the same `animateCameraLayerWAAPI()` as camera layers, with `prevSpriteMotionTransformById` caching "from" transforms per sprite ID. Adds `renpy-player__sprite-motion--animating` CSS class during animation (removed on complete/cancel).
- `.renpy-player__sprite-pulse` — hosts scale-only pulse keyframes (kept separate so baseline translate is not unintentionally scaled).
- `.renpy-player__sprite-normalize` — static normalization scale derived from first-resolved asset height.
- `<SmartImage.renpy-player__sprite>` — image swap/fade is handled by SmartImage; swap-start is bus-tracked during `phase === 'scene'`.

### SmartImage Lanczos3 Resampling

`SmartImage` optionally downsamples oversized images via Pica (Lanczos3) to reduce GPU memory and improve rendering quality. This spans `SmartImage.vue` (resampling + blob lifecycle), `SceneLayer.vue` (passes prop), and `useRenpyPlayerController.ts` (computes target height).

- **Target height**: `spriteResampleTargetHeight = stageHeight * 2`, passed to every `<SmartImage>` instance via `resample-target-height` prop. Undefined = disabled.
- **Activation gate**: Resampling only fires when `naturalHeight > resampleTargetHeight * 1.5` (real downsampling only, never upsampling).
- **Blob URL ownership**: SmartImage tracks all blob URLs it creates via `ownedBlobUrls` Set. Revoked when no longer displayed (not in `currentSrc` or `previousSrc`) and on unmount. This prevents memory leaks.
- **Output format**: PNG (lossless, no re-encoding artifacts).
- **Dimension invariant**: `naturalWidth`/`naturalHeight` in the resolved payload come from the original image, not the resampled canvas — normalization scale must be based on the original aspect ratio.

### Cross-Message Bridge

When navigating between messages, `pendingBridge` supplies the last frame of the previous message as `prevFrame` to `applyFrame`, so scene transitions animate correctly rather than snapping from `null`.

## Sharp Edges

- **`flush()` is both read and clear.** It returns a snapshot and clears pending animations. Don't call it just for the side effect without capturing the return value.
- **`source:'message'`** is returned when `ignoredLines.length > 0` even if `commands.length === 0`.
- **`ensurePlayerHost()`** must be called on `CHAT_CHANGED` — SillyTavern rebuilds the chat DOM.
- **Normalization scale locks on first `SmartImage` resolution.** Hot-swapping a character's asset set after initial load will not update the scale.
- **`TransitionGroup`** keys sprites by `renderKey = sprite.id`. Re-showing the same character updates the existing node; enter/leave hooks only fire for genuine add/remove.
- **Speaker display** uses `displayedSpeaker` (from `useDialogueReveal`), not a direct computed from the current frame. Has a three-way transition model (appear/disappear/change).
- **`beginReveal()` is called by the phase FSM** — do not call it directly from other code.
- **`isBusy`** is derived from the Phase FSM (`useFramePhase`) and gates transport controls. Treat it as "frame is not ready to advance yet". Never set `phase.value` directly — the FSM manages all transitions.
- **`autoPlayDelayMs`** in settings schema is a dead field — not read anywhere. Do not wire new code to it. Use `autoAdvanceDelayMs` instead.
- **`hudHideScope`** controls when the HUD hides: `'scene-only'` (default) hides during scene crossfades; `'all-motion'` hides during any bus activity. `hudShowInProgress` blocks `scene → reveal` until the HUD show animation completes.
- **`pendingFrameTarget { kind: 'last' }`** uses `Number.MAX_SAFE_INTEGER` as a sentinel; the `watch(frames)` handler clamps it.
- **Camera presentation** (`backgroundCameraStyle`, `spriteCameraStyle`, `spriteStyle`, `cameraAnimationClass`) reads from `displayedCamera`/`displayedCameraAnimations`, not `currentFrame`. Camera transitions use WAAPI only (no CSS `transition` property on camera layers); `resolvedCameraTransitionMs` drives WAAPI duration + will-change toggling.
- **Fallback timeouts** — WAAPI transform trackers use a `duration + 50ms` fallback timeout in case `finish/cancel` events are not delivered. Sprite enter WAAPI animations also set a 3s fallback if `<SmartImage>` never resolves.
- **SmartImage swap blockers have fallback cleanup.** Swap blockers are de-duped per sprite/background key and auto-cleaned via timeout (`swapDurationMs + 75ms` buffer) even if the element unmounts mid-swap. Cleanup is also run on scope dispose. Swaps that begin after `phase !== 'scene'` are ignored to avoid hiding HUD mid-reveal.
- **Sprite lazy loading and WAAPI** — In `onSpriteEnter`, WAAPI animations must wait for `<SmartImage>` to emit `@resolved` (via `triggerSpriteEnterAnimation`), otherwise the fade runs on a blank unpainted shell. But `bus.register()` must still happen synchronously upfront to block the FSM while the image loads.
- **Camera shake vs sprite shake.** Camera shake (scene-layer keyframes) is bus-tracked via a fixed 450ms timeout. Sprite shake/bounce/pulse are NOT tracked and do not block reveal (by design).
- **`--renpy-camera-transition-ms` is legacy/diagnostic.** Camera + sprite motion use WAAPI exclusively; the variable may remain for styling/diagnostics but does not control transform animation timing.

---

Update this file when implemented behavior changes in a way an agent should know before editing.
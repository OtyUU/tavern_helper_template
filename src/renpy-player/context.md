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

`SceneLayer` and camera computeds read from `displayedBackground`, `displayedSprites`, `displayedCamera` (`PlayerCameraIntent`), and `displayedCameraAnimations` — not from `currentFrame`. During a scene crossfade, these refs update at deliberate moments (background/camera at midpoint, sprites at the end). **Any new visual presentation code must read from `displayed*` refs, never from `currentFrame` directly.**

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

To register a new animation with the bus: call `bus.register(cancelFn)` when the animation starts, call the returned cleanup when it finishes. Cleanup must be idempotent. Unregistered animations will not block phase transitions.

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

Camera pan + zoom is applied to two sibling `renpy-player__camera-layer` divs in `SceneLayer.vue`, not to individual sprites or the background element. Each layer gets its own computed style (`backgroundCameraStyle` / `spriteCameraStyle`) with `translate(x, y) scale(zoom)`.

- **Unified zoom.** A single `backgroundScale` per preset controls zoom for both layers. The old separate `spriteScale` is dead — `spriteStyle` always sets `--sprite-scale: 1`. The schema still carries `*SpriteScale` fields for backward compatibility but nothing reads them.
- **Parallax.** `bgPanParallax` (0–1) multiplies the pan offset on the background camera layer. At 1.0 the background pans identically to sprites; below 1.0 it moves less (parallax effect).
- **Inline transitions.** Camera layers use `resolvedCameraTransitionMs` (a computed, not a CSS variable) which returns 0 when `effectsDisabled` or `isSceneTransitioning`. This avoids sub-pixel jitter from `translate3d` + CSS-variable-based transitions.
- **Pixel-based sprite shells.** Sprite horizontal position is `transform: translate3d(xPx, 0, 0) translateX(-50%)` computed via `stageWidth`, not a `left: %`. This is because camera-layer `scale()` would distort percentage-based `left` positions.
- **`PlayerCameraIntent`** (types.ts) carries `preset`, `panXPct?`, `panYPct?` — no pixel values, safe to persist through history replay. `normalizeCameraFromFrame()` in `camera-utils.ts` migrates legacy `cameraTransform` frames.
- **Transition tracking.** `useScenePresentation` tracks `transform` transitions on both camera layer elements (`backgroundCameraElement`, `spriteCameraElement`), not on the background `<img>` directly.

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
- **`isBusy`** is `computed(() => phase.value === 'scene')`. Gates transport controls. Never set `phase.value` directly — the FSM manages all transitions.
- **`autoPlayDelayMs`** in settings schema is a dead field — not read anywhere. Do not wire new code to it. Use `autoAdvanceDelayMs` instead.
- **`hudHideScope`** controls when the HUD hides: `'scene-only'` (default) hides during scene crossfades; `'all-motion'` hides during any bus activity. `hudShowInProgress` blocks `scene → reveal` until the HUD show animation completes.
- **`pendingFrameTarget { kind: 'last' }`** uses `Number.MAX_SAFE_INTEGER` as a sentinel; the `watch(frames)` handler clamps it.
- **Camera presentation** (`backgroundCameraStyle`, `spriteCameraStyle`, `spriteStyle`, `cameraAnimationClass`) reads from `displayedCamera`/`displayedCameraAnimations`, not `currentFrame`. Camera transitions are inline (`resolvedCameraTransitionMs`) and zeroed during `isSceneTransitioning`.
- **Fallback timeouts** — CSS transition trackers set `cameraTransitionMs + 50` ms fallbacks in case `transitionend` never fires.

---

Update this file when implemented behavior changes in a way an agent should know before editing.
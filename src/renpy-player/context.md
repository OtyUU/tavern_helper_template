# Ren'Py Player Context

Agent-facing context for `src/renpy-player`. Covers architecture, invariants, and traps — things that span multiple files or would cause bugs if missed. For implementation details, read the relevant source file directly.

## Data Pipeline (core mental model)

1. **Parse** — `parseScriptFromMessage(message)` → flat `ScriptCommand[]`
2. **Replay history** — `getInitialState()` feeds all prior messages through `StageState` → `InitialPlayerState`. Stateless: same inputs = same output.
3. **Build frames** — `buildFrames(parsed, { initialState })` emits one `PlayerFrame` per `dialogue` command.
4. **Select** — cursor (`activeMessageId` + `frameIndex`) → `currentFrame`
5. **Present** — `watch(currentFrame)` → `applyFrame()` in `useScenePresentation` → updates `displayed*` refs that Vue renders

## The displayed/current Split

All rendering reads from `displayedBackground`, `displayedSprites`, `displayedCamera`, `displayedCameraAnimations` — **never from `currentFrame` directly**. During scene crossfades these update at deliberate moments (bg/camera at midpoint, sprites at end). `applyDisplayedFrame()` only writes a ref when its value actually changes (content comparison), preventing spurious WAAPI captures.

`renderedSprites` (computed in controller) projects `displayedSprites` into render-ready objects adding `renderKey`, `motionStyle`, `normalizeStyle`, animation classes, `swapDurationMs`. `SceneLayer.vue` renders `renderedSprites`, not `displayedSprites`.

## Runtime Environment

- **Script module, not an iframe.** Vue apps mount onto the SillyTavern host page via jQuery. No `index.html`.
- **Style teleportation.** Compiled styles don't reach the host page. `teleportStyle()` copies them. Use unscoped SCSS with `renpy-player__` BEM — no Tailwind, no `:deep()`.
- **DOM re-anchoring.** `ensurePlayerHost()` must be called on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED` — SillyTavern rebuilds the chat DOM.
- **Auto-imports.** Vue Composition API, Zod (`z`), VueUse, Pinia are auto-imported. Options API disabled — always use `<script setup lang="ts">`.
- **`getChatMessages()` is not reactive.** Any computed calling it must read `historyTrigger.value` first to be invalidated by `fullSync()`.

## Architectural Invariants

### Stateless Parser + History Replay

Parser has no persistent state. On every recompute: fetch messages 0..N-1, parse each, feed into a temporary `StageState`, `flush()` → `InitialPlayerState`, pass as `initialState` to `buildFrames()`. Editing any earlier message propagates forward automatically on the next `historyTrigger` bump.

**The parser must remain truly stateless** — no module-level mutable state, no caches that outlive a single call.

### `scene` command behaviour

A bare `scene` (no background name) clears sprites and resets camera to `default` but **keeps the current background unchanged**. Only updates background when a name is provided.

### `buildFrames` synthetic frames

If no dialogue commands exist but visuals do, a synthetic frame is appended:
- No commands at all → speaker `'Active Scene'`
- Commands present but no dialogue → speaker `'Scene Preview'`
- Trailing non-dialogue commands after last dialogue + `stage.hasVisuals()` → `'Scene Preview'` frame appended

### Phase FSM

Three phases: `scene → reveal → done`. Every frame advance resets to `scene`.

- **`scene`**: Blocks until `bus.count === 0` AND `blockReveal === false`. In instant/reduced-motion mode, fires immediately.
- **`reveal`**: `beginReveal()` starts typewriter. Stage clicks skip to full reveal.
- **`done`**: Ready to advance.

**What blocks `scene → reveal` (registered with bus):**
- Scene crossfade (timeout-based)
- Sprite enter/leave fades (WAAPI via TransitionGroup hooks)
- Camera transform WAAPI
- Sprite motion WAAPI
- SmartImage swaps during `phase === 'scene'` (timeout-based, de-duped per key)
- Camera shake (fixed 450ms timeout)

**Intentionally NOT registered:** sprite keyframe animations (shake/bounce/pulse), HUD show/hide (gated via `hudShowInProgress`/`blockReveal` instead), dialogue reveal itself.

**Important:** `bus.register()` must happen **synchronously** before an animation begins. If deferred into `requestAnimationFrame` or behind an image load, FSM can see `count === 0` and prematurely advance.

### Settings Mutation

`updateSettings(draft => { ... })` is the **only** way controller code mutates settings — clones via `klona()`, runs updater, assigns back. Never `settings.value.x = ...` directly. `klona()` is also required before any `insertOrAssignVariables()` call.

### Sync Tiers

- **`fullSync()`** — Heavy: rebuilds playable index, bumps `historyTrigger`, resolves message IDs. For `CHAT_CHANGED`, `MESSAGE_DELETED`, `MORE_MESSAGES_LOADED`, initial mount.
- **`refreshCurrentMessageOnly()`** — Light: bumps `historyTrigger` only. For in-place edits/swipes of the current message.

### Generation Lock

1. `GENERATION_STARTED` predicts target message ID, adds to `excludedPlayableMessageIds`, jumps viewport to safe prior frame.
2. First `MESSAGE_UPDATED` confirms (or retargets) the lock. Subsequent updates for the locked target are ignored.
3. `GENERATION_ENDED` / `GENERATION_STOPPED` clears exclusions and rebuilds index.

### Motion Mode

- `'instant'` — backward navigation, manual jumps, safe-frame jumps. Zeroes all transition durations.
- `'normal'` — forward navigation, cross-message forward jumps.
- `effectsDisabled = prefersReducedMotion || motionMode === 'instant'`

### Camera Architecture

Two sibling `camera-layer` divs (bg + sprites) each get `scale + translate3d` via `backgroundCameraStyle` / `spriteCameraStyle`. Animated with WAAPI (not CSS transitions) using a FLIP pattern: "from" captured from `prevBackgroundTransform`/`prevSpriteTransform` refs, "to" read in `nextTick`. `sharedTransformStartTime` synchronizes start time across both layers and sprite motions.

**Firefox:** Uses `cubic-bezier(0.15, 0.05, 0.85, 0.95)` instead of `ease` to avoid transform animation shimmer.

**Auto pan:** When `panXPct` is undefined in `PlayerCameraIntent`, camera auto-centers visible sprites via `autoPanXPct` computed.

### Cross-Message Bridge

`pendingBridge` supplies the last frame of the previous message as `prevFrame` to `applyFrame()` so transitions animate correctly across messages.

`createBridge: true` only on **forward** navigation (`stepForwardInternal` cross-message, `maybeFollowLatestPlayable`). All **backward** navigation and manual jumps use `createBridge: false` — a stale bridge going backward produces incorrect transition "from" state.

## Sharp Edges

- **`flush()` is read AND clear.** Returns snapshot AND clears `pendingCameraAnimations` AND `sprite.animations` on every sprite. Don't call just for the side effect.
- **`isMessagePlayable`** checks `commands.length > 0`, not `source !== 'none'`. A message with only unparseable lines returns `source:'message'` but is **not** playable and won't appear in the index.
- **Normalization scale locks on first `SmartImage` resolution.** Hot-swapping a character's asset set after initial load won't update the scale.
- **`beginReveal()` is called by the phase FSM only** — do not call from other code.
- **`autoPlayDelayMs`** in settings is a dead field. Use `autoAdvanceDelayMs`.
- **`cancelAllEffects()`** is the nuclear teardown (backward nav, `jumpToSafeFrameBefore`). Calls `resetToScene`, `clearReveal`, `clearTransitionTimeouts`, `clearSpriteVisibilityTransitions`, resets `isSceneTransitioning`. Do **not** use for same-message frame transitions — `resetToScene` alone suffices.
- **Sprite WAAPI enter** must wait for `<SmartImage>` `@resolved` to start the animation, but `bus.register()` must happen synchronously upfront (before the image loads) to hold the FSM.
- **`ensurePlayerHost()`** must be re-called on `CHAT_CHANGED`.
- **`prevFrameForDiff`** must not derive from displayed state — displayed state can be temporarily cleared at scene crossfade midpoint, which would break swap duration diffs.
- **`{{vn_state}}` macro** (`status-macro.ts`) replays history on every expansion. For `swipe`/`regenerate` generation types it excludes the last message (the one being replaced).

---

Update this file when implemented behavior changes in a way an agent should know before editing.
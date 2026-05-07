# Ren'Py Player Context

Agent-facing context for `src/renpy-player`. Trust this over upstream Ren'Py docs.

## Purpose

Renders a Ren'Py-like VN viewport inside the SillyTavern chat UI from LLM-produced text. The **chat** is the interaction surface; the **viewport** visualizes parsed scene + dialogue frames for the selected message. By default it follows the latest message containing recognized commands.

## System Overview

Understanding how the pieces connect is prerequisite to modifying any of them.

**Data flow — parse → frame → display:**

1. `parseScriptFromMessage(message)` turns raw chat text into a flat list of `ScriptCommand` objects.
2. `buildFrames(parsed, options)` runs those commands through a `StageState` machine and emits one `PlayerFrame` per `dialogue` command (plus optional preview frames for visual-only scripts). Frames are plain snapshots — `{ background, sprites, cameraTransform, speaker, text, … }` — with no behaviour attached.
3. `inheritedState` (computed in the controller) replays all *prior* messages through `getInitialState()` so each message's frames start from the correct visual context. See **Inherited State & Reactivity Model** below.
4. The **cursor** — `activeMessageId + frameIndex` — selects exactly one frame. `currentFrame` is the computed result.
5. `watch(currentFrame)` calls `applyFrame(next, prev)` in `useScenePresentation`, which updates the `displayed*` refs that Vue renders via `SceneLayer`.

**Sequencing — the phase FSM + TransitionBus:**

Updating `currentFrame` starts a three-phase cycle managed by `useFramePhase`:

- **`scene`**: `applyFrame` fires CSS transitions and Web Animations, each registering with `useTransitionBus`. The FSM waits for `bus.count === 0` before advancing.
- **`reveal`**: Visual motion has settled. `beginReveal()` starts the typewriter effect in `useDialogueReveal`.
- **`done`**: Text is fully revealed. Stage clicks advance the cursor; autoplay waits its configured delay then does the same.

**The displayed/current split:**

`SceneLayer` and the camera computeds read from `displayedBackground`, `displayedSprites`, `displayedCameraTransform`, and `displayedCameraAnimations` — refs owned by `useScenePresentation` — not from `currentFrame` directly. During a scene crossfade these refs update at deliberate moments (background and camera at the midpoint fade, sprites at the end) rather than all at once when `currentFrame` changes. Any new code that presents visual state must follow this pattern.

## Runtime Environment

- **Module type**: Tavern Helper **script** (`index.ts` only, no `index.html`). Mounts Vue apps directly onto the SillyTavern host page via jQuery — not inside an iframe.
- **jQuery scope**: `$` operates on the host page (`window.$ = window.parent.$`).
- **Style teleportation**: Styles compiled in the background iframe don't reach the host page. `teleportStyle()` copies compiled `<style>` elements into the host `<head>`. Use unscoped SCSS with BEM `renpy-player__` classes — **no Tailwind** (class collisions with SillyTavern).
- **Swipes/regenerations**: Swiping does **not** change `message_id` — the same message gets new swipe text.
- **Lifecycle**: Init in `$(() => { ... })`. Cleanup via `$(window).on('pagehide', ...)`.
- **DOM mounting**: Player host: `attr('id', 'th-renpy-player')`, inserted before `$('#chat')`. Must re-attach on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED`. Settings host: appended to `#extensions_settings2`. Single `createPinia()` in `index.ts`, shared by both apps.

## Build System & Auto-Imports

**Auto-imported (no import statement):** Vue Composition API (`ref`, `computed`, `watch`, `watchEffect`, `onMounted`, `onScopeDispose`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `storeToRefs`, `inject`, `provide`, `reactive`, `readonly`), `z` (Zod), `klona`, VueUse functions from `@vueuse/core`.

**Require explicit import:** local modules, `@util/script` utilities, `.vue` components.

**Constraints:** Options API disabled. Always use `<script setup lang="ts">`. Path alias: `@util/` → project-root `util/`.

## Tavern Helper Globals

| Global | Purpose |
|---|---|
| `getChatMessages(id)` | Fetch by ID, range (`'0-5'`), or negative depth (`-1` = latest). Returns `ChatMessage[]`. |
| `getLastMessageId()` | Highest message ID (0-based). |
| `getVariables({ type, script_id })` | Read script-scoped variables. |
| `insertOrAssignVariables(obj, target)` | Write/merge variables. Always `klona()` reactive values first. |
| `getScriptId()` | Unique ID string of this script. |
| `eventOn(eventType, cb)` | Subscribe to event. Returns `{ stop }`. |
| `registerMacroLike(regex, replacer)` | Register prompt macro. Returns `{ unregister }`. |
| `createScriptIdDiv(id)` | Creates a `<div>` with `id` attribute and returns the jQuery element. Used for mounting player and settings hosts. |

**ChatMessage shape:** `{ message_id: number, name, role, is_hidden, message: string, data, extra }`

### Event Callback Signatures

| Event | Callback |
|---|---|
| `CHAT_CHANGED` | `(chat_file_name: string) => void` |
| `MESSAGE_RECEIVED` | `(message_id: number, type: string) => void` |
| `MESSAGE_SENT` | `(message_id: number) => void` |
| `MESSAGE_EDITED` / `MESSAGE_UPDATED` / `MESSAGE_DELETED` / `MESSAGE_SWIPED` | `(message_id: number) => void` |
| `MORE_MESSAGES_LOADED` | `() => void` |
| `GENERATION_STARTED` | `(type: string, option: object, dry_run: boolean) => void` |
| `GENERATION_STOPPED` | `() => void` |
| `GENERATION_ENDED` | `(message_id: number) => void` |

`GENERATION_STARTED` fires for internal dry-run pipeline passes (`dry_run: true`). All generation-lock logic must ignore these.

## File Map

Runtime files only (test and utility files excluded):

| File | Role |
|---|---|
| `index.ts` | Mounts apps, registers `teleportStyle()`, wires `pagehide` cleanup |
| `App.vue` | Creates controller, provides it, renders `<PlayerStage />` |
| `PlayerStage.vue` | Stage div with click handler; renders `<SceneLayer />` + `<ViewportOverlay />` |
| `SceneLayer.vue` | Background `SmartImage`, scene fade div, sprite `TransitionGroup` (enter/leave hooks) |
| `ViewportOverlay.vue` | HUD: dialogue bar (grapheme spans, `displayedSpeaker`), transport controls, message stepper, `<DiagnosticsPanel />` |
| `SmartImage.vue` | Candidate waterfall loading, swap crossfade, emits `resolved` (with `naturalWidth`/`naturalHeight`) and `resolutionStatus` |
| `DiagnosticsPanel.vue` | `<details>` diagnostics UI |
| `SettingsPanel.vue` | Settings UI only |
| `useRenpyPlayerController.ts` | Orchestration: store wiring, playable-index, frame/message selection, stage geometry, generation lock, lifecycle, event handlers. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`, `phase`. |
| `useTransitionBus.ts` | Lightweight registry for tracking in-flight visual transitions. Provides reactive `count`, `register()`, `cancelAll()`, and `dispose()`. |
| `useFramePhase.ts` | Phase FSM composable: manages `scene → reveal → done` state machine, coordinates with TransitionBus, calls `beginReveal()` at correct time. Accepts optional `blockReveal` param to delay reveal. |
| `player-composables.ts` | `useScenePresentation`, `useSpriteVisibilityTransitions`, `useDialogueReveal`, `useAutoplay`, `useReducedMotion`. |
| `player-context.ts` | `InjectionKey` + `useRenpyPlayer()` inject helper |
| `parser.ts` | Grammar, token resolution, `StageState`, `buildFrames()`, `getInitialState()` |
| `types.ts` | Command, asset, frame, and state contracts |
| `settings.ts` | Zod schema, settings repair, character config parsing, Pinia store, persistence wiring |
| `status-macro.ts` | `{{vn_state}}` macro: replays history → formats `InitialPlayerState` as Ren'Py-style text. Exports `computePlayerStatus` (testable entry point) and `registerPlayerStatusMacro`. Module-level `activeGenerationType` tracks current generation type for regen detection. |
| `renpy-player.scss` | All player styles (unscoped, BEM). No `:deep()` — use descendant selectors |
| `context.md` | This file |

## Script Grammar

Line-based. Empty lines, full-line `#`/`//` comments, and trailing inline comments are stripped.

### Source Selection

`parseScriptFromMessage()` prefers the first fenced code block if it contains recognized commands (`source = 'fenced'`). Otherwise it parses the whole message — if the result has any commands **or** `ignoredLines`, `source = 'message'`; otherwise `source = 'none'`.

### Inline Comments

`stripInlineComment()` strips trailing comments outside quotes. `#` always starts a comment. `//` only starts a comment at start-of-line or after whitespace (`chinami//comment` and URLs are preserved).

### Recognized Forms

```
scene <background> [segment]
hide <character>
hide all
camera
camera at <transform>[, <transform>...]
show <character> [tokens...] [in <outfit>] [blush] [at <transform>[, <transform>...]]
<speaker> [tokens...] [in <outfit>] [blush] "<text>"
<speaker> "<text>"
"<text>"
```

### Key Semantics

- **`scene`**: clears visible sprites (not remembered outfits); reuses previous segment when omitted; marks next frame `isNewScene`.
- **`hide`**: removes visible sprite; does not clear remembered outfit.
- **`hide all`**: clears all visible sprites; background/segment/camera/remembered outfits are preserved.
- **`camera`** / **`camera at`**: allowed persistent transforms: `closeup`, `medium`; one-shot animation: `shake`. Bare `camera` clears transform + pending animations.
- **`show` `at` clause**: must be last. Positions: `left`, `center`, `right`; animations: `shake`, `bounce`, `pulse`.
- **Token resolution** (after `in`/`blush` extraction):
  - 2+ tokens → first = pose, second = expression
  - 1 token → pose if in `poseTokens`, else expression
  - 0 tokens → inherit current or fall back to defaults
- **Blush persistence**: explicit `blush` sets true; changing expression without `blush` clears it; otherwise carries forward.
- **Say-with-attrs** (`chinami base neutral "Hello"`) emits a `show` command then a `dialogue` command.
- Invalid lines go to `ParsedScript.ignoredLines`.

## State & Frames

- Visual commands mutate `StageState` but do not emit frames.
- `dialogue` command emits a frame from the current stage state via `stage.flush()`.
- `flush()` returns a snapshot `{ background, cameraTransform, cameraAnimations, sprites }` **and** clears pending camera animations and one-shot sprite animations. It is both a read and a clear.
- Scripts with visuals but no dialogue emit a single preview frame.
- Trailing visual-only commands after the last dialogue emit a `Scene Preview` frame.
- `getInitialState()` replays earlier messages oldest→newest, then calls `flush()` to prevent history animations leaking into frame 0.
- Remembered outfits persist even when a character is hidden.
- Camera transform persists until cleared; camera animation does not.

## Inherited State & Reactivity Model

**The parser is stateless.** `buildFrames` and `getInitialState` are pure functions — given the same inputs they return the same outputs. There is no mutable runtime stage that accumulates changes as the conversation grows.

**Statefulness comes from replaying history on every recompute.** When the controller needs the frames for message N, it:

1. Fetches all messages `0` through `N-1` (ordered newest-first for performance, then reversed internally).
2. Runs each through `parseScriptFromMessage` and feeds the commands into a temporary `StageState` inside `getInitialState`.
3. Calls `flush()` on that stage to get `InitialPlayerState` — the visual context at the start of message N.
4. Passes that as `options.initialState` into `buildFrames(parsedScript, options)`.

This means **editing any message in the conversation automatically propagates forward** — on the next `historyTrigger` bump, `inheritedState` recomputes from scratch, which causes `frames` to recompute, which causes `currentFrame` to update.

**`historyTrigger`** is the reactive bridge. `getChatMessages()` is not reactive, so a plain `ref` is incremented whenever the history may have changed (`fullSync`, `refreshCurrentMessageOnly`). Any computed that calls `getChatMessages()` must read `historyTrigger.value` first to opt into this reactivity.

**Performance implication:** Every navigation that changes `activeMessageId` triggers a full history replay for the new message. The replay is synchronous and CPU-bound — it scales with conversation length. This is acceptable for typical chat lengths but is worth knowing before adding work inside `getInitialState` or `parseScriptFromMessage`.

**Correctness implication:** The parser must remain truly stateless — no module-level mutable state, no caches that outlive a single `buildFrames` call. Side effects inside the parser would produce different results depending on call order, breaking the replay guarantee.

## Asset Resolution

Paths use normalized forward slashes. Candidates are built for every extension in `assetExtensions` in order. `SmartImage` tries them in order, uses the first that loads.

### Backgrounds
`<assetRoot>/bg/<background>[-<segment>].<ext>`

### Sprites
`<assetRoot>/<character>/<outfit>/<poseCandidate>/<expression>[-blush].<ext>`

- **Pose fallback chain** (up to 8, deduplicated): `wantedPose` → `defaultPose` → each entry in `poseTokens`
- Character, outfit, pose, expression, background, segment are lowercased in paths.

### Character Config (`characterSpriteConfig`)
Per-character JSON keys: `defaultOutfit`, `poseTokens`, `referenceHeight`. Keys starting with `_` are comments. Unknown fields are silently dropped.

### Sprite Normalization Pipeline
1. `SmartImage` emits `resolved` with `{ naturalHeight }`.
2. `onSpriteResolved(spriteId, { naturalHeight })` records the height **only on first resolution** — subsequent asset swaps do not update the scale.
3. `characterNormalizationScales` computes `referenceHeight / naturalHeight` per character.
4. The scale is injected as `--sprite-normalize-scale` in `shellStyle` on `renderedSprites` and applied in CSS via `calc(var(--sprite-scale) * var(--sprite-normalize-scale))`.

### Key Defaults
```
assetExtensions = 'png,jpg,jpeg,webp'
defaultPose = 'base'
defaultExpression = 'neutral'
globalPoseTokens = 'base,burst,lean,sit,stand'
spriteReferenceHeight = 2000
stageHeight = 480
```

## Settings Schema — Notable Fields

- **`preferredMessageId`** (nullable int): persisted across sessions; seeds `activeMessageId` and `manualMessageId` on startup; written on every navigation action.
- **`followLatestPlayable`** (boolean, default `true`): when true, any new playable message snaps the viewport forward.
- **`autoAdvanceDelayMs`**: wait after reveal completes before autoplay advances. Effective total delay is `textFadeMs + autoAdvanceDelayMs` because autoplay cannot advance until `isFullyRevealed` is true.
- **`autoPlayDelayMs`**: present in schema (500–20000, default 2500) but **not read anywhere** — dead field. Do not wire new code to it.
- **`hudHideScope`** (`'scene-only' | 'all-motion'`, default `'scene-only'`): controls when the HUD hides. `'scene-only'` hides during scene crossfades (`isSceneTransitioning`); `'all-motion'` hides during any visual transition (`bus.count > 0`).
- **`hudHideDurationMs`** (0–1000, default 160): CSS opacity/transform transition duration when HUD hides.
- **`hudShowDurationMs`** (0–1000, default 220): CSS opacity/transform transition duration when HUD reappears. Also gates `blockReveal` — typewriter reveal waits for the HUD show animation to complete.
- **`hudHideDriftPx`** (0–60, default 10): vertical pixel drift when HUD hides (`translateY`).

## Phase System Architecture

The player uses a **phase-based state machine** to coordinate visual animations and dialogue reveal timing.

### Phase FSM

Three phases govern frame playback:

1. **`'scene'`** — Visual animations are settling. Dialogue reveal is blocked. Transport controls are disabled. Stage clicks are ignored.
2. **`'reveal'`** — Visual motion has settled. Typewriter reveal is active or ready to skip. Transport controls are enabled. Stage clicks skip to fully revealed text.
3. **`'done'`** — Everything complete. Ready to advance. Stage clicks advance frame. Autoplay can proceed.

**Transition rules:**
- Phases always follow: `scene → reveal → done`
- Every frame advance resets phase to `'scene'`
- `beginReveal()` is called exactly once when entering `'reveal'`
- In instant/reduced-motion mode: `scene → reveal` fires immediately without waiting for `bus.count === 0`

### TransitionBus

Tracks in-flight visual transitions via a reactive `count`. Any animation that should block dialogue reveal must `register()` with the bus. When `bus.count` reaches 0, the FSM transitions `scene → reveal`.

**Core API:**
```typescript
interface TransitionBus {
  register(cancel: () => void): () => void;  // Returns cleanup function
  cancelAll(): void;
  dispose(): void;
  readonly count: Ref<number>;
}
```

To register a new animation type: accept `bus` in your composable, call `bus.register(cancelFn)` when the animation starts, and call the returned cleanup when it finishes or is cancelled. Cleanup functions must be idempotent — the bus may call them multiple times.

### `isBusy`

`computed(() => phase.value === 'scene')`. Gates `canStepForward`, `canStepBackward`, `canToggleAutoplay` start, and the advance path in `onStageClick`. Never manually set `phase.value` — the FSM manages all transitions.

## HUD Hide/Show System

The HUD hides during visual motion and reappears after motion settles.

### Signal Chain

1. **`isHudHidden`** (computed): `true` when visual motion is in progress (scope from `hudHideScope`). Always `false` when `effectsDisabled`.
2. **CSS classes**: `ViewportOverlay.vue` binds `--hidden` or `--visible` on `.renpy-player__hud-shell`. CSS transitions use `--renpy-hud-hide-ms`, `--renpy-hud-show-ms`, `--renpy-hud-hide-drift-ms`, `--renpy-hud-drift-px`.
3. **`hudShowInProgress`** (ref): becomes `true` on the hidden→visible edge for `hudShowDurationMs`, then auto-clears.
4. **`blockReveal`** (computed): `!effectsDisabled && hudShowInProgress`. Passed to `useFramePhase` as 8th parameter, gating `scene → reveal` until the HUD show animation completes.

### CSS Variable Mapping

All four variables are computed in `stageStyle` and zeroed when `effectsDisabled` is true:
- `--renpy-hud-hide-ms`: `hudHideDurationMs`
- `--renpy-hud-show-ms`: `hudShowDurationMs`
- `--renpy-hud-hide-drift-ms`: `Math.round(hudHideDurationMs * 1.25)` (computed in JS, not CSS `calc()`)
- `--renpy-hud-drift-px`: `hudHideDriftPx`

All cleanup paths clear `hudShowTimeout` and reset `hudShowInProgress` to false.

## VN-Style Input Semantics

### Stage Click Behavior

| Phase | Click action |
|---|---|
| `'scene'` | Ignored — visual transitions settling |
| `'reveal'` | Skips to fully revealed text (`skipReveal()`) |
| `'done'` | Advances to next frame (`stepForwardInternal()`) |

Stage clicks do **not** stop autoplay — they participate in the autoplay flow.

### Transport Control Gating

Step backward is disabled when `isBusy` (phase `=== 'scene'`). There is no step forward button; forward navigation is via stage clicks or autoplay. In instant mode, `isBusy` is always false.

### Autoplay Coordination

Autoplay waits for `phase === 'done'` before advancing, then waits `autoAdvanceDelayMs` (effective total: `textFadeMs + autoAdvanceDelayMs`). `isFullyRevealed` need not be checked separately — the FSM only enters `'done'` once it is true. All manual navigation actions stop autoplay; stage clicks do not.

## Controller Architecture

### `updateSettings(draft => { ... })`
The **only** way controller code mutates `settings.value`. Clones via `klona()`, runs the updater on the draft, then assigns back. Never assign `settings.value.x = ...` directly.

### Event Handler Routing
`MESSAGE_EDITED`, `MESSAGE_UPDATED`, and `MESSAGE_SWIPED` all go through `handleMessageModified(messageId, eventType)`. When `eventType === 'MESSAGE_UPDATED'` and generation is in progress, it delegates to `handleMessageUpdatedDuringGeneration(messageId)` for lock-confirm logic; otherwise calls `rebuildPlayableIndex()` + `onMessageChanged(messageId)`.

`MESSAGE_RECEIVED` and `MESSAGE_SENT` both check `followLatestPlayable`, validate message playability, rebuild the playable index, and switch viewport to the latest playable message with smooth transitions.

### Sync Paths (two tiers)
- **`fullSync(options?)`**: rebuilds playable index, bumps `historyTrigger`, resolves and sets `activeMessageId`/`manualMessageId`/`preferredMessageId`. Used on `CHAT_CHANGED`, `MESSAGE_DELETED`, `MORE_MESSAGES_LOADED`, and initial mount.
- **`refreshCurrentMessageOnly()`**: bumps `historyTrigger` only, no index rebuild. Used for in-place edits/updates of the current message.

### Deferred Position Tokens
`pendingFrameTarget: null | { kind: 'first' } | { kind: 'last' }` defers `frameIndex` resolution to when `frames` recomputes:
- `{ kind: 'last' }`: set before jumping backward across messages. `frameIndex = Number.MAX_SAFE_INTEGER` is used as a sentinel; the `watch(frames)` handler clamps it to `frames.length - 1`.
- `{ kind: 'first' }`: set in `jumpToSafeFrameBefore` when the safe frame is ahead of the excluded target.

### Seamless Cross-Message Bridge
`pendingBridge: { targetKey: string; prevFrame: PlayerFrame } | null` supplies the correct `prevFrame` to `applyFrame` when changing messages, so scene transitions animate against the last frame of the prior message rather than `null`. Set just before `activeMessageId` changes in `stepForwardInternal`, `onMessageReceived` (follow-latest), and the follow-latest nudge in `useLatestPlayable`. Consumed and cleared in `watch(currentFrame)` when the key matches.

### Generation Safe-Frame Lock
- **`GENERATION_STARTED`** (non-dry-run, non-quiet): predicts target message ID — if last message is `role:'user'`, predict `last + 1`; else predict `last`. Adds to `excludedPlayableMessageIds`; rebuilds index; if current viewport is on the excluded ID, calls `jumpToSafeFrameBefore` (sets `motionMode = 'instant'`).
- **First `MESSAGE_UPDATED`** while lock is active is treated as authoritative; may retarget the lock to a different message ID. Subsequent `MESSAGE_UPDATED` events for the locked target are ignored to avoid parse churn.
- **`GENERATION_ENDED` / `GENERATION_STOPPED`**: clears exclusions, rebuilds index.

### `motionMode`
- `'instant'`: set by `jumpToSafeFrameBefore`, manual message ID application, and backward navigation.
- `'normal'`: set by `setMotionModeForNav(targetIndex)` when `targetIndex >= frameIndex`, and explicitly by `stepForwardInternal` and `onMessageReceived` on cross-message forward jumps.
- `effectsDisabled = prefersReducedMotion || motionMode === 'instant'` — zeros all transition durations.

### Autoplay
- `canToggleAutoplay` requires `hasNextStep.value` to **start** autoplay. The button is disabled at end-of-chat if autoplay is not already active.
- Once active, autoplay idles (stays enabled) at end-of-chat or during generation lock.
- All manual actions (transport buttons, jump-to-latest, message stepper, typed message ID apply) stop autoplay.

### Camera Presentation
`backgroundStyle`, `spriteStyle`, `cameraAnimationClass`, and `cameraDiagnosticsLabel` read from `displayedCameraTransform` / `displayedCameraAnimations` (owned by `useScenePresentation`), **not** `currentFrame`. During scene crossfades, `displayedCameraTransform` commits at midpoint and `displayedCameraAnimations` at final, preventing camera "teleport" under the fade overlay. `--renpy-camera-transition-ms` is zeroed while `isSceneTransitioning` is true. Do not wire new camera presentation code to `currentFrame.value?.cameraTransform`.

### Message ID Input
- Typing updates `manualMessageId` only — does not change active message or restart reveal.
- Applying (blur / change / Enter) calls `resolveNearestPlayableId` to snap to the nearest playable ID. Typing `50` when the nearest playable is `48` silently moves to `48`.

### `SceneLayer` rendering
`renderedSprites` augments each displayed sprite with: `renderKey`, `animationClass`, `shellStyle` (including `--sprite-ref-height` and `--sprite-normalize-scale`), and `swapDurationMs` for `SmartImage`.

## Status Macro (`{{vn_state}}`)

Output format (empty string if no background and no visible sprites):
```
scene <background> [<segment>]
camera at <transform>          ← only if set
show <char> in <outfit> <pose> <expression>[ blush] at <position>

[offstage]
<character>: <outfit>          ← remembered outfits for hidden characters
```

Regenerations/swipes: `activeGenerationType` (tracked via `GENERATION_STARTED` / `GENERATION_ENDED`) determines whether to exclude the last message. Module-level `null` state logs a warning and defaults to full history.

## Sharp Edges

- **Script module, not iframe UI.** No `index.html`, no Tailwind, no scoped CSS.
- **`klona()` is mandatory** before `insertOrAssignVariables()` or any Tavern Helper API receiving a reactive value. Within the controller, always use `updateSettings(draft => { ... })`.
- **`ensurePlayerHost()`** must be called on `CHAT_CHANGED` — SillyTavern rebuilds the chat DOM.
- **`source:'message'`** is returned when `ignoredLines.length > 0` even if `commands.length === 0`.
- **`flush()` is both read and clear** — do not call it just for its side effect without capturing the return value.
- **Normalization scale is locked on first `SmartImage` resolution.** Hot-swapping a character's asset set after initial load will not update the scale.
- **`TransitionGroup`** keys sprites by `renderKey = sprite.id`. Re-showing the same character updates the existing DOM node; enter/leave hooks only fire for genuine add/remove.
- **Speaker display** uses `displayedSpeaker` (managed by `useDialogueReveal`), not a direct computed from the current frame. Three-way transition: appear (fade in via `speakerFadeMs`), disappear (fade out, then clear after `speakerFadeMs`), no change (instant update).
- **`pendingFrameTarget { kind: 'last' }` uses `Number.MAX_SAFE_INTEGER`** as a sentinel; the `watch(frames)` handler clamps it.
- **`beginReveal()` is called by the phase FSM** — do not call it directly from other code.
- **Animation registration is mandatory** — any animation that should block dialogue reveal must register with TransitionBus. Unregistered animations will not gate phase transitions.
- **`useFramePhase` `blockReveal` default** — the 8th parameter defaults to `ref(false)`. Existing 7-argument call sites are unaffected.
- **`isHudHidden` is exposed in `scene` namespace** — access via `controller.scene.isHudHidden` in components.
- **Fallback timeouts** — `trackElementTransition` and `trackSpriteShellTransition` each set a fallback of `cameraTransitionMs + 50` ms in case `transitionend`/`transitioncancel` never fires.

Update this file when implemented behavior changes in a way an agent should know before editing.
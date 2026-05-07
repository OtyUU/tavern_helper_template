# Ren'Py Player Context

Agent-facing context for `src/renpy-player`. Trust this over upstream Ren'Py docs.

## Purpose

Renders a Ren'Py-like VN viewport inside the SillyTavern chat UI from LLM-produced text. The **chat** is the interaction surface; the **viewport** visualizes parsed scene + dialogue frames for the selected message. By default it follows the latest message containing recognized commands.

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
| `useRenpyPlayerController.ts` | Orchestration: store wiring, playable-index, frame/message selection, stage geometry, generation lock, lifecycle, event handlers. Integrates phase FSM and TransitionBus. Camera presentation computeds (`backgroundStyle`, `spriteStyle`, `cameraAnimationClass`, `cameraDiagnosticsLabel`) read from **displayed** camera state (`displayedCameraTransform` / `displayedCameraAnimations`), not `currentFrame`, so they update at the correct moment during scene crossfades. `--renpy-camera-transition-ms` is zeroed during `isSceneTransitioning` to prevent camera transforms from animating under the fade overlay. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`, `phase`. `scene.isHudHidden` drives HUD hide/show CSS. All settings mutations go through `updateSettings(draft => { ... })` which `klona()`s before writing. |
| `useTransitionBus.ts` | TransitionBus composable: lightweight registry for tracking in-flight visual transitions. Provides reactive `count`, `register()`, `cancelAll()`, and `dispose()` methods. |
| `useFramePhase.ts` | Phase FSM composable: manages phase state machine (`scene → reveal → done`), coordinates with TransitionBus, calls `beginReveal()` at correct time, provides `isBusy` computed. Accepts optional `blockReveal` param to delay reveal (used by HUD show-in-progress gating). |
| `player-composables.ts` | `useScenePresentation`, `useSpriteVisibilityTransitions`, `useDialogueReveal`, `useAutoplay`, `useReducedMotion`. Scene presentation exposes `displayedCameraTransform` / `displayedCameraAnimations` (decoupled from `currentFrame` reactivity) so camera state commits at the correct moment during scene crossfades (transform at midpoint, animations at final). Scene and sprite composables register animations with TransitionBus. `trackElementTransition` and `trackSpriteShellTransition` include fallback timeouts (`cameraTransitionMs + 50`). `useDialogueReveal` exports `beginReveal()` for phase FSM to call. |
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
- **`autoPlayDelayMs`**: present in schema (500–20000, default 2500) but **not read anywhere** — dead field.
- **`hudHideScope`** (`'scene-only' | 'all-motion'`, default `'scene-only'`): controls when the HUD hides. `'scene-only'` hides during scene crossfades (`isSceneTransitioning`); `'all-motion'` hides during any visual transition (`bus.count > 0`).
- **`hudHideDurationMs`** (0–1000, default 160): CSS opacity/transform transition duration when HUD hides.
- **`hudShowDurationMs`** (0–1000, default 220): CSS opacity/transform transition duration when HUD reappears. Also gates `blockReveal` — typewriter reveal waits for the HUD show animation to complete.
- **`hudHideDriftPx`** (0–60, default 10): vertical pixel drift when HUD hides (`translateY`).

## Phase System Architecture

The player uses a **phase-based state machine** to coordinate visual animations and dialogue reveal timing. This ensures dialogue text waits for visual motion to settle before starting typewriter reveal, creating an immersive VN experience.

### Phase FSM (Finite State Machine)

Three phases govern frame playback:

1. **`'scene'`** — Visual animations are settling (scene crossfade, sprite transitions, camera effects, CSS positioning). Dialogue reveal is blocked. Transport controls are disabled. Stage clicks are ignored.

2. **`'reveal'`** — Visual motion has settled. Typewriter reveal is active or ready to skip. Transport controls are enabled. Stage clicks skip to fully revealed text.

3. **`'done'`** — Everything is complete (visuals settled, text fully revealed). Ready to advance to next frame. Stage clicks advance frame. Autoplay can proceed.

**Phase Transition Rules:**
- Phases always follow the sequence: `scene → reveal → done`
- Phases never skip states (except instant mode: `scene → reveal` directly)
- Every frame advance resets phase to `'scene'`
- `beginReveal()` is called exactly once when entering `'reveal'` phase

### TransitionBus

A lightweight registry that tracks in-flight visual transitions. Provides a reactive `count` ref that equals the number of registered animations.

**Core API:**
```typescript
interface TransitionBus {
  register(cancel: () => void): () => void;  // Returns cleanup function
  cancelAll(): void;                          // Cancel all registered transitions
  dispose(): void;                            // Cleanup on unmount
  readonly count: Ref<number>;                // Reactive count of in-flight transitions
}
```

**Usage Pattern:**
```typescript
// In animation composable
const cleanup = bus.register(() => {
  clearTimeout(handle);
  animation.cancel();
});

// Auto-cleanup when animation completes
animation.addEventListener('finish', () => {
  cleanup();
}, { once: true });
```

**When `bus.count` reaches 0**, the phase FSM transitions from `'scene'` to `'reveal'` and calls `beginReveal()`.

### Registering New Animation Types

To add a new animation type that blocks dialogue reveal:

1. **Accept `bus` parameter** in your composable
2. **Register cancellation** when starting the animation
3. **Auto-cleanup** when animation completes or is cancelled

**Example: Scene Crossfade Registration**
```typescript
function applyFrame(next: PlayerFrame | null, prev: PlayerFrame | null): void {
  if (!next?.isNewScene || effectsDisabled.value) {
    applyDisplayedFrame(next);
    return;
  }
  
  const halfDuration = Math.floor(settings.value.sceneTransitionMs / 2);
  const fullDuration = settings.value.sceneTransitionMs;
  isSceneTransitioning.value = true;
  displayedCameraAnimations.value = undefined;
  
  const midpointHandle = setTimeout(() => {
    displayedBackground.value = next.background;
    displayedCameraTransform.value = next.cameraTransform;
    updateDisplayedSprites([]);
  }, halfDuration);
  
  let unregister: (() => void) | null = null;
  const finalHandle = setTimeout(() => {
    updateDisplayedSprites(next.sprites ?? []);
    displayedCameraAnimations.value = next.cameraAnimations;
    isSceneTransitioning.value = false;
    transitionTimeouts.value = [];
    unregister?.();
    unregister = null;
  }, fullDuration);
  
  transitionTimeouts.value = [midpointHandle, finalHandle];
  
  unregister = bus.register(() => {
    clearTimeout(midpointHandle);
    clearTimeout(finalHandle);
    transitionTimeouts.value = [];
    isSceneTransitioning.value = false;
  });
}
```

**Example: Web Animation Registration**
```typescript
function onSpriteEnter(el: Element, done: () => void) {
  const animation = el.animate([...], { duration });
  
  const cleanup = bus.register(() => animation.cancel());
  
  animation.addEventListener('finish', () => {
    cleanup();
    done();
  }, { once: true });
  
  animation.addEventListener('cancel', () => {
    cleanup();
    done();
  }, { once: true });
}
```

**Example: CSS Transition Registration**
```typescript
function trackCameraTransition(el: HTMLElement) {
  const cleanup = bus.register(() => {
    el.removeEventListener('transitionend', handler);
  });
  
  const handler = () => cleanup();
  el.addEventListener('transitionend', handler, { once: true });
}
```

### Instant Mode Behavior

When `effectsDisabled` is true (reduced motion or instant mode):
- Phase transitions directly from `'scene'` to `'reveal'` without waiting for `bus.count === 0`
- `beginReveal()` is called immediately
- No animations register with the bus
- Transport controls are never disabled
- Frame application completes in <1ms

### Phase-Based UI Logic

**`isBusy` Computed:**
```typescript
const isBusy = computed(() => phase.value === 'scene');
```

Use `isBusy` to gate UI elements:
- Disable transport buttons when `isBusy`
- Show loading indicators when `isBusy`
- Prevent user actions during scene settlement

**Phase-Aware Components:**
```typescript
// In a Vue component
const { phase, isBusy } = inject(RenpyPlayerKey)!;

// Conditional rendering
<button :disabled="isBusy">Next Frame</button>

// Phase-specific styling
<div :class="{ 'opacity-50': phase === 'scene' }">
```

## HUD Hide/Show System

The HUD (dialogue bar + transport rail) hides during visual motion and reappears after motion settles, creating a cinematic VN effect.

### Signal Chain

1. **`isHudHidden`** (computed in controller): `true` when visual motion is in progress (scope depends on `hudHideScope` setting). Returns `false` when `effectsDisabled` is true (instant/reduced-motion mode).
2. **CSS classes**: `ViewportOverlay.vue` binds `--hidden` or `--visible` modifier class on `.renpy-player__hud-shell` based on `isHudHidden`. CSS transitions handle the opacity/transform animation using `--renpy-hud-hide-ms`, `--renpy-hud-show-ms`, `--renpy-hud-hide-drift-ms`, and `--renpy-hud-drift-px` CSS variables.
3. **`hudShowInProgress`** (ref): becomes `true` on the hidden→visible edge for `hudShowDurationMs`, then auto-clears via `window.setTimeout`.
4. **`blockReveal`** (computed): `!effectsDisabled && hudShowInProgress`. Passed as 8th parameter to `useFramePhase`, gating the scene→reveal transition. This delays typewriter reveal until the HUD show animation completes.

### CSS Variable Mapping

All four CSS variables are computed in `stageStyle` and respect `effectsDisabled` (zeroed to `0ms`/`0px`):
- `--renpy-hud-hide-ms`: `hudHideDurationMs`
- `--renpy-hud-show-ms`: `hudShowDurationMs`
- `--renpy-hud-hide-drift-ms`: `Math.round(hudHideDurationMs * 1.25)` (slightly longer drift gives a natural ease-out feel)
- `--renpy-hud-drift-px`: `hudHideDriftPx`

### Timeout Cleanup

- `hudShowTimeout` is cleared in `watch(currentFrame)` (frame navigation), `onScopeDispose`, and the `watch(isHudHidden)` watcher itself (re-entrant hidden edge).
- `hudShowInProgress` is reset to `false` in all cleanup paths.

### Pointer Events

`.renpy-player__hud-shell` already has `pointer-events: none`. The `--hidden` modifier adds `pointer-events: none` to child `.renpy-player__dialogue-bar` and `.renpy-player__hud-rail` (which normally have `pointer-events: auto`). This prevents interaction with invisible controls during the hide animation.

### Interaction with Phase FSM

- `useFramePhase` accepts an optional 8th parameter `blockReveal: Ref<boolean>` (default `ref(false)`).
- The scene→reveal watcher adds `&& !blockReveal.value` to its condition: `if (bus.count.value === 0 && !blockReveal.value)`.
- In instant mode, `blockReveal` is always `false` (because `effectsDisabled` is true), so the gate is transparent — reveal starts immediately as before.

### Fallback Timeouts

`trackElementTransition` and `trackSpriteShellTransition` in `player-composables.ts` each set a fallback timeout of `cameraTransitionMs + 50` ms. If the DOM `transitionend`/`transitioncancel` event never fires (e.g., element removed, transition property mismatch), the fallback calls `complete()` and clears the bus registration. The fallback handle is cleared inside the existing `complete()` closure (idempotent via `finished` flag).

## VN-Style Input Semantics

The player implements traditional visual novel click behavior where the meaning of a click depends on the current phase.

### Stage Click Behavior

**Phase: `'scene'`** (visual animations settling)
- Click is **ignored**
- Prevents accidental interruption of visual transitions
- User must wait for animations to complete

**Phase: `'reveal'`** (typewriter revealing text)
- Click **skips to fully revealed text**
- Calls `skipReveal()` to instantly show all remaining characters
- Phase transitions to `'done'` when skip completes

**Phase: `'done'`** (everything complete)
- Click **advances to next frame** (if available)
- Calls `stepForwardInternal()` (which handles both intra-message and cross-message navigation)
- Restarts phase cycle at `'scene'` for new frame
- Does nothing if no next frame exists

**Implementation (simplified):**
```typescript
function onStageClick() {
  if (phase.value === 'scene') return;
  
  if (phase.value === 'reveal') {
    skipReveal();
    return;
  }
  
  if (phase.value === 'done' && canStepForward.value) {
    stepForwardInternal();
  }
}
```

Note: `stepForwardInternal()` takes a different code path than `applyNextFrame('forward')` when navigating across message boundaries — it sets `activeMessageId` directly instead of calling `applyNextFrame`.

### Transport Control Gating

Transport buttons (step forward/backward) are gated by `isBusy`:

**When `phase === 'scene'`:**
- Step backward button: **disabled**
- Prevents navigation during visual transitions

**When `phase !== 'scene'`:**
- Transport controls: **enabled**
- User can navigate freely once scene settles

Note: There is no step forward button in the HUD. Forward navigation is via stage clicks or autoplay (`transport.stepForward` is called internally by autoplay but is not wired to a visible button).

**Instant mode exception:**
- Transport controls are **never disabled**
- `isBusy` is always false in instant mode

### Autoplay Coordination

Autoplay waits for the complete phase cycle before advancing:

**Phase: `'scene'`**
- Autoplay **waits** (does not advance)
- Allows visual animations to complete

**Phase: `'reveal'`**
- Autoplay **waits** (does not advance)
- Allows typewriter reveal to complete

**Phase: `'done'`**
- Autoplay **can advance** after configured delay
- `canAutoAdvanceNow` checks `phase === 'done'`
- Effective delay = `textFadeMs + autoAdvanceDelayMs`

**Frame advance behavior:**
- When autoplay advances, phase resets to `'scene'`
- Phase cycle restarts for the new frame
- Autoplay continues waiting through the new cycle

**Implementation:**
```typescript
const canAutoAdvanceNow = computed(() => 
  phase.value === 'done' &&
  hasNextStep.value &&
  !isGenerationInProgress.value
);
```

Note: `isFullyRevealed` is absent here because it is implicitly guaranteed — the FSM only enters `'done'` when `isFullyRevealed` is already `true`.

### Manual Navigation Actions

All manual navigation actions **stop autoplay**:
- Transport button clicks (step forward/backward)
- Jump-to-latest button
- Message stepper navigation
- Typed message ID application

**Stage clicks do NOT stop autoplay** — they skip reveal or advance frame as part of the autoplay flow.

## Controller Architecture

### `updateSettings(draft => { ... })`
The **only** way controller code mutates `settings.value`. Clones via `klona()`, runs the updater on the draft, then assigns back. All direct `settings.value.x = ...` assignments have been replaced with this pattern. Never assign to `settings.value` properties directly.

### Event Handler Routing
`MESSAGE_EDITED`, `MESSAGE_UPDATED`, and `MESSAGE_SWIPED` all go through `handleMessageModified(messageId, eventType)`. When `eventType === 'MESSAGE_UPDATED'` and generation is in progress, it delegates to `handleMessageUpdatedDuringGeneration(messageId)` for lock-confirm logic; otherwise it calls `rebuildPlayableIndex()` + `onMessageChanged(messageId)`.

`MESSAGE_RECEIVED` and `MESSAGE_SENT` follow the same viewport switching pattern: both check `followLatestPlayable`, validate message playability, rebuild the playable index, and switch viewport to the latest playable message with smooth transitions. `MESSAGE_SENT` provides immediate visual feedback when users send Ren'Py commands, mirroring the behavior of AI-generated messages.

### Sync Paths (two tiers)
- **`fullSync(options?)`**: rebuilds playable index, bumps `historyTrigger`, resolves and sets `activeMessageId`/`manualMessageId`/`preferredMessageId`. Used on `CHAT_CHANGED`, `MESSAGE_DELETED`, `MORE_MESSAGES_LOADED`, and initial mount.
- **`refreshCurrentMessageOnly()`**: bumps `historyTrigger` only, no index rebuild. Used for in-place edits/updates of the current message.

### Deferred Position Tokens
`pendingFrameTarget: null | { kind: 'first' } | { kind: 'last' }` defers `frameIndex` resolution to when `frames` recomputes (needed because `activeMessageId` changes before the new frames are available):
- `{ kind: 'last' }`: set before jumping backward across messages (`stepBackwardInternal`, `jumpToSafeFrameBefore`). `frameIndex = Number.MAX_SAFE_INTEGER` is used as a sentinel; the `watch(frames)` handler clamps it to `frames.length - 1`.
- `{ kind: 'first' }`: set in `jumpToSafeFrameBefore` when the safe frame is ahead of the excluded target.

### Seamless Cross-Message Bridge
`pendingBridge: { targetKey: string; prevFrame: PlayerFrame } | null` supplies the correct `prevFrame` to `applyFrame` when changing messages, so scene transitions animate against the last frame of the prior message rather than `null`. Set just before `activeMessageId` changes in `stepForwardInternal`, `onMessageReceived` (follow-latest), and the follow-latest nudge in `useLatestPlayable`. Consumed and cleared in `watch(currentFrame)` when the key matches.

### `isBusy`
`computed(() => phase.value === 'scene')`. Gates `canStepForward`, `canStepBackward`, start of `canToggleAutoplay`, and the advance path in `onStageClick`. When true, visual animations are settling and user navigation is blocked.

### Generation Safe-Frame Lock
- **`GENERATION_STARTED`** (non-dry-run, non-quiet): predicts target message ID — if last message is `role:'user'`, predict `last + 1`; else predict `last`. Adds to `excludedPlayableMessageIds`; rebuilds index; if current viewport is on the excluded ID, calls `jumpToSafeFrameBefore` (sets `motionMode = 'instant'`).
- **First `MESSAGE_UPDATED`** while lock is active is treated as authoritative; may retarget the lock to a different message ID. Subsequent `MESSAGE_UPDATED` events for the locked target are ignored to avoid parse churn.
- **`GENERATION_ENDED` / `GENERATION_STOPPED`**: clears exclusions, rebuilds index.

### `motionMode`
- `'instant'`: set by `jumpToSafeFrameBefore`, manual message ID application, and backward navigation.
- `'normal'`: set by `setMotionModeForNav(targetIndex)` when `targetIndex >= frameIndex` (forward), and explicitly by `stepForwardInternal` and `onMessageReceived` on cross-message forward jumps.
- `effectsDisabled = prefersReducedMotion || motionMode === 'instant'` — zeros all transition durations.

### Autoplay
- `canToggleAutoplay` requires `hasNextStep.value` to **start** autoplay. The button is disabled at end-of-chat if autoplay is not already active.
- Once active, autoplay idles (stays enabled) at end-of-chat or during generation lock.
- Stage click does **not** stop autoplay — it skips reveal or advances frame.
- All other manual actions (transport buttons, jump-to-latest, message stepper, typed message ID apply) stop autoplay.

### Message ID Input
- Typing into the stepper input updates `manualMessageId` only — does not change active message or restart reveal.
- Applying (blur / change / Enter) calls `resolveNearestPlayableId` to snap to the nearest playable ID. The input is then overwritten with the resolved value. Typing `50` when the nearest playable is `48` silently moves to `48`.
- `followLatestPlayable` is **not** cleared by manual message selection.

### `SceneLayer` rendering
`SceneLayer` iterates `controller.scene.renderedSprites` (not `displayedSprites` directly). `renderedSprites` is a computed that augments each sprite with: `renderKey`, `animationClass`, `shellStyle` (including `--sprite-ref-height` and `--sprite-normalize-scale`), and `swapDurationMs` for `SmartImage`.

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
- **`klona()` is mandatory** before `insertOrAssignVariables()` or any Tavern Helper API receiving a reactive value. Within the controller, always use `updateSettings(draft => { ... })` instead of direct `settings.value` property assignment.
- **`ensurePlayerHost()`** must be called on `CHAT_CHANGED` — SillyTavern rebuilds the chat DOM.
- **`source:'message'`** is returned when `ignoredLines.length > 0` even if `commands.length === 0`.
- **`flush()` is both read and clear** — do not call it just for its side effect without capturing the return value.
- **Normalization scale is locked on first `SmartImage` resolution.** Hot-swapping a character's asset set after initial load will not update the scale.
- **`autoPlayDelayMs`** is in the schema but unused. Do not wire new code to it; use `autoAdvanceDelayMs`.
- **`GENERATION_STARTED` dry runs**: fire after a normal reply completes; `dry_run === true` must be ignored by any generation-lock logic.
- **`at` clause** is only valid as the final clause in `show` / `camera at`.
- **Say-with-attrs emits two commands** — `show` then `dialogue`.
- **`TransitionGroup`** keys sprites by `renderKey = sprite.id`. Re-showing the same character updates the existing DOM node; enter/leave hooks only fire for genuine add/remove.
- **Camera presentation uses displayed state, not `currentFrame`** — `backgroundStyle`, `spriteStyle`, `cameraAnimationClass`, and `cameraDiagnosticsLabel` read from `displayedCameraTransform` / `displayedCameraAnimations` (owned by `useScenePresentation`). During scene crossfades, `displayedCameraTransform` commits at midpoint and `displayedCameraAnimations` commits at final, preventing camera "teleport" under the fade overlay. `--renpy-camera-transition-ms` is zeroed while `isSceneTransitioning` is true. Do not wire new camera presentation code to `currentFrame.value?.cameraTransform`; use the displayed refs instead.
- **Speaker display** uses `displayedSpeaker` (managed by `useDialogueReveal`), not a direct computed from the current frame. Three-way transition: appear (fade in via `speakerFadeMs`), disappear (fade out, then clear after `speakerFadeMs`), no change (instant update).
- **Effective autoplay delay** = `textFadeMs + autoAdvanceDelayMs`. Autoplay will not advance until `isFullyRevealed` is true.
- **`pendingFrameTarget { kind: 'last' }` uses `Number.MAX_SAFE_INTEGER`** as a sentinel for `frameIndex`; the `watch(frames)` handler clamps it.
- **Phase transitions are automatic** — do not manually set `phase.value`. The phase FSM manages transitions based on `bus.count` and `isFullyRevealed`.
- **`beginReveal()` is called by phase FSM** — do not call it directly from other code. The phase system ensures it's called exactly once per frame at the correct time.
- **Animation registration is mandatory** — any animation that should block dialogue reveal must register with TransitionBus. Unregistered animations will not gate phase transitions.
- **Cleanup functions must be idempotent** — TransitionBus may call cleanup multiple times (on completion and on `cancelAll()`). Ensure cleanup functions handle repeated calls gracefully.
- **`useFramePhase` blockReveal default** — the 8th parameter defaults to `ref(false)`. Existing 7-argument call sites are unaffected. When providing a custom `blockReveal`, it must be a `Ref<boolean>`; `computed` works because it extends `Ref`.
- **HUD CSS variables are set in JS** — `--renpy-hud-hide-drift-ms` is computed as `Math.round(hudHideDurationMs * 1.25)` in the controller, not via CSS `calc()`. The values are zeroed when `effectsDisabled` is true.
- **`isHudHidden` is exposed in `scene` namespace** — access via `controller.scene.isHudHidden` in components.

Update this file when implemented behavior changes in a way an agent should know before editing.
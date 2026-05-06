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
| `useRenpyPlayerController.ts` | Orchestration: store wiring, playable-index, frame/message selection, stage geometry, generation lock, lifecycle, event handlers. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`. All settings mutations go through `updateSettings(draft => { ... })` which `klona()`s before writing. |
| `player-composables.ts` | `useScenePresentation`, `useSpriteVisibilityTransitions`, `useDialogueReveal`, `useAutoplay`, `useReducedMotion` |
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
`computed(() => isSceneTransitioning.value)`. Gates `canStepForward`, start of `canToggleAutoplay`, and the advance path in `onStageClick`.

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
- **Speaker display** uses `displayedSpeaker` (managed by `useDialogueReveal`), not a direct computed from the current frame. Three-way transition: appear (fade in via `speakerFadeMs`), disappear (fade out, then clear after `speakerFadeMs`), no change (instant update).
- **Effective autoplay delay** = `textFadeMs + autoAdvanceDelayMs`. Autoplay will not advance until `isFullyRevealed` is true.
- **`pendingFrameTarget { kind: 'last' }` uses `Number.MAX_SAFE_INTEGER`** as a sentinel for `frameIndex`; the `watch(frames)` handler clamps it.

Update this file when implemented behavior changes in a way an agent should know before editing.
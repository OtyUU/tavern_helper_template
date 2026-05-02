# Ren'Py Player Context

Agent-facing context for `src/renpy-player`.

## Purpose

- Renders a small Ren'Py-like visual novel preview inside the Tavern Helper / SillyTavern chat UI.
- Implements a custom script subset defined in `parser.ts` and rendered as `PlayerFrame[]` by `buildFrames()`.
- Does not implement real Ren'Py execution, branching, variables, ATL, audio, menus, labels, jumps, save/load, or screen language.
- If behavior is unclear, trust local source over upstream Ren'Py documentation.

## Runtime Environment

- **Module type**: This is a Tavern Helper **script** (only `index.ts`, no `index.html`). It does not render inside an iframe UI. Instead it mounts Vue components directly onto the SillyTavern host page using jQuery.
- **jQuery scope**: In scripts, `$` operates on the host SillyTavern page (`window.$ = window.parent.$`), so `$('#chat')` selects the real chat element on the host page, not the iframe's DOM.
- **Style teleportation**: Styles compiled inside the background iframe do not reach the host page. `teleportStyle()` is called once in `index.ts` to copy all compiled `<style>` elements into the host page's `<head>`. This is why the module uses unscoped SCSS with BEM-prefixed `renpy-player__` classes — **do not use tailwindcss** (class names would collide with SillyTavern's existing CSS).
- **Lifecycle**:
  - Init inside `$(() => { ... })` — never `DOMContentLoaded` (it does not fire for dynamically-loaded scripts).
  - Cleanup via `$(window).on('pagehide', ...)` — not `'unload'`.
  - The controller also uses Vue `onMounted`/`onScopeDispose` internally, which works because it is created inside `App.vue`'s `<script setup>`.

## Build System & Auto-Imports

### Auto-Imported (no import statement needed)

- **Vue Composition API**: `ref`, `computed`, `watch`, `watchEffect`, `onMounted`, `onScopeDispose`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `storeToRefs`, `inject`, `provide`, `reactive`, `readonly`, and all other Vue exports.
- **Zod**: `z` (the root zod namespace).
- **klona**: `klona` (deep-clone utility for stripping Vue Proxy before persistence).
- **VueUse**: functions from `@vueuse/core`, components and directives from `unplugin-vue-components`.

### NOT Auto-Imported (require explicit import)

- Local modules (`./parser`, `./types`, etc.)
- Utility functions from `@util/script` (e.g., `createScriptIdDiv`, `teleportStyle`)
- Vue components from other `.vue` files

### Build Constraints

- **Options API is disabled** (`__VUE_OPTIONS_API__ = false`). Always use Composition API with `<script setup lang="ts">`.
- **Path alias**: `@util/` resolves to `util/` at the project root (e.g., `import { createScriptIdDiv } from '@util/script'`).

## Tavern Helper Globals

All Tavern Helper APIs are ambient globals — no import needed. They are typed in `@types/function/` and `@types/iframe/`.

### APIs Used by This Module

| Global | Purpose | Notes |
|---|---|---|
| `getChatMessages(id)` | Fetch chat messages by ID or range | Returns `ChatMessage[]` (array); `[0]` may be `undefined`. Accepts number, string range (`'0-5'`), or negative depth (`-1` = latest). |
| `getLastMessageId()` | Highest message ID (0-based) in current chat | Returns `number` |
| `getVariables({ type, script_id })` | Read script-scoped variables | Returns `Record<string, any>` |
| `insertOrAssignVariables(obj, { type, script_id })` | Write/merge variables into script scope | Always wrap reactive values in `klona()` first |
| `getScriptId()` | Unique ID string of this running script | Used for DOM scoping (`script_id` attr) and variable namespacing |
| `eventOn(eventType, callback)` | Subscribe to an event | Returns `{ stop }` for manual cleanup. Auto-cleaned when iframe closes. |
| `tavern_events` | Object mapping event names to string constants | Full catalog in `@types/iframe/event.d.ts` |
| `registerMacroLike(regex, replacer)` | Register a prompt/display macro | Returns `{ unregister }`. Replacer receives `(context, substring, ...args)`. |

### ChatMessage Shape

The controller accesses `currentMessage.value?.message` and `currentMessage.value?.message_id`:

```text
ChatMessage {
  message_id: number
  name: string
  role: 'system' | 'assistant' | 'user'
  is_hidden: boolean
  message: string
  data: Record<string, any>
  extra: Record<string, any>
}
```

## File Map

### Controller & State

- `useRenpyPlayerController.ts`: orchestration composable — store wiring, message/frame selection, rendered sprite pipeline, stage geometry, dialogue reveal wiring, lifecycle (`onMounted`/`onScopeDispose`), tavern event subscriptions, autoplay stop + reveal + transition cleanup. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`.
- `player-context.ts`: `InjectionKey<RenpyPlayerController>` + `useRenpyPlayer()` inject helper. All extracted components inject the controller via this module.

### Vue Components

- `App.vue`: thin wrapper — creates controller, provides it, renders `<PlayerStage />`. No logic.
- `PlayerStage.vue`: stage root — renders `<SceneLayer />` + `<ViewportOverlay />` inside the stage div with click handler.
- `SceneLayer.vue`: scene rendering — background `SmartImage` (bound to `controller.scene.displayedBackground`, not `currentFrame.background`), scene fade div, gradient, sprite `TransitionGroup` with enter/leave hooks.
- `ViewportOverlay.vue`: HUD overlay — empty state, dialogue bar (speaker + grapheme spans with per-char fade), transport controls, autoplay button, message selection stepper, frame counter. Renders `<DiagnosticsPanel />`.
- `DiagnosticsPanel.vue`: diagnostics `<details>` UI — reads controller.diagnostics, controller.model, controller.scene.
- `SmartImage.vue`: candidate waterfall loading, swap crossfade, `resolved` emit.
- `SettingsPanel.vue`: settings UI only; keep behavior in `settings.ts` or `useRenpyPlayerController.ts`.

### Styles

- `renpy-player.scss`: all styles for the player (unscoped). Imported once from `index.ts`. No `:deep()` usage — descendant selectors target child components directly.

### Supporting Modules

- `parser.ts`: grammar, token resolution, `StageState`, `buildFrames()`, `getInitialState()`
- `types.ts`: shared command, asset, frame, and state contracts
- `settings.ts`: Zod schema, saved-settings repair, character config parsing, Pinia store, persistence wiring
- `player-composables.ts`: scene presentation (`useScenePresentation`), visibility transitions (`useSpriteVisibilityTransitions`), dialogue reveal (`useDialogueReveal`), autoplay (`useAutoplay`), reduced-motion handling (`useReducedMotion`)
- `status-macro.ts`: `{{vn_state}}` macro that formats `InitialPlayerState` as Ren'Py-style text for prompt injection
- `index.ts`: mounts `App.vue` into `#th-renpy-player` and `SettingsPanel.vue` into `#extensions_settings2`. Imports `renpy-player.scss` once.
- `context.md`: agent-facing source of truth; update when behavior changes

## DOM Mounting

- **`createScriptIdDiv()`** (from `@util/script`): creates `<div script_id="...">`. Tavern Helper uses `script_id` for scoped DOM management and auto-cleanup.
- **Player host**: created with `attr('id', 'th-renpy-player')` and inserted before `$('#chat')`. Must be re-attached on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED` because SillyTavern rebuilds the chat DOM on those events.
- **Settings host**: appended to `#extensions_settings2` (SillyTavern's standard extension settings area).
- **Shared Pinia**: a single `createPinia()` instance is created in `index.ts` and `.use()`'d on both `playerApp` and `settingsApp`, so they share the same store state.
- **`teleportStyle()`**: clones all `<style>` from the iframe `<head>` into a `<div script_id="...">` appended to the host `<head>`. `destroy()` removes that div. Called once in `index.ts`.

## Integration

- `index.ts` mounts:
  - `App.vue` into `#th-renpy-player`, inserted before `#chat`
  - `SettingsPanel.vue` into `#extensions_settings2`
- `getChatMessages(id)[0]` is optional. Treat missing messages as normal when walking history or selecting a message id.
- `index.ts` re-inserts the player host on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED`, and unmounts both apps on `pagehide`.
- `useRenpyPlayerController()` owns lifecycle internally: reduced-motion setup/cleanup, tavern event subscriptions + disposal, autoplay stop + reveal clear + transition cleanup. It uses `onMounted` + `onScopeDispose`.
- The controller recomputes selection on chat-history events such as receive, edit, update, delete, swipe, and load.

### Event Callback Signatures

Events used by this module and what their callbacks receive:

| Event | Callback signature |
|---|---|
| `CHAT_CHANGED` | `(chat_file_name: string) => void` |
| `MESSAGE_RECEIVED` | `(message_id: number, type: string) => void` |
| `MESSAGE_EDITED` | `(message_id: number) => void` |
| `MESSAGE_UPDATED` | `(message_id: number) => void` |
| `MESSAGE_DELETED` | `(message_id: number) => void` |
| `MESSAGE_SWIPED` | `(message_id: number) => void` |
| `MORE_MESSAGES_LOADED` | `() => void` |
| `GENERATION_STARTED` | `(type: string) => void` — used in `status-macro.ts` to distinguish swipe/regenerate from normal generation |
| `GENERATION_ENDED` | `(message_id: number) => void` — used in `status-macro.ts` |

## Script Grammar

Parsing is line-based. Empty lines and lines starting with `#` or `//` are ignored.

### Source Selection

- `parseScriptFromMessage()` first inspects the first fenced code block.
- If that block contains at least one recognized command, only that block is parsed and `source = 'fenced'`.
- Otherwise the whole message is parsed and `source = 'message'`.
- If nothing is recognized, `source = 'none'`.

### Recognized Forms

```text
scene <background> [segment]
hide <character>
camera
camera at <transform>[, <transform>...]
show <character> [tokens...] [in <outfit>] [blush] [at <transform>[, <transform>...]]
<speaker> [tokens...] [in <outfit>] [blush] "<text>"
<speaker> "<text>"
"<text>"
```

Implemented examples:

```text
scene living_room night
hide chinami
camera
camera at closeup
camera at closeup, shake
show chinami base neutral
show chinami in maid_uniform blush at left, bounce
eileen happy "Hi"
chinami base neutral "Hello"
"Narration"
```

### Semantics

- `scene <background> [segment]`
  - Matches alphanumeric, `_`, `-` tokens only.
  - Clears visible sprites, keeps remembered outfits, and marks the next emitted frame as `isNewScene`.
  - If `segment` is omitted, the previous background segment is reused.
- `hide <character>`
  - Removes the visible sprite and its render-order entry.
  - Does not clear remembered outfit for that character.
- `camera`
  - Clears the persistent camera transform and any pending camera animations.
- `camera at ...`
  - Allowed transforms: `closeup`, `medium`, `shake`
  - `closeup` and `medium` are persistent camera transforms.
  - `shake` is a one-frame camera animation.
- `show <character> ...`
  - Optional `at` clause must be last.
  - Allowed show transforms:
    - positions: `left`, `center`, `right`
    - animations: `shake`, `bounce`, `pulse`
  - Optional `in <outfit>` selects outfit.
  - Optional `blush` is a keyword, not a generic token.
  - Remaining tokens resolve as:
    - 2+ tokens: first = pose, second = expression
    - 1 token: pose if it matches configured pose tokens, otherwise expression
    - 0 tokens: reuse current pose/expression or fall back to defaults
  - Blush persistence:
    - explicit `blush` always sets blush to true
    - changing the resolved expression without explicit `blush` clears blush
    - otherwise existing blush state is carried forward
- Say-with-attributes lines like `chinami base neutral "Hello"` emit both:
  - a `show` command using the speaker as the character id
  - a `dialogue` command
- `speaker "text"` emits dialogue only.
- Bare quoted text emits narrator dialogue.

### Ignored Lines

- Invalid lines are collected in `ParsedScript.ignoredLines`.
- A line is ignored if it matches no recognized form.
- `show` is ignored if its `at` clause is empty or contains unsupported transforms.
- `camera at` is ignored if the transform list is empty or contains unsupported transforms.
- Only quoted dialogue is recognized; unquoted free text is ignored.

## State And Frames

- `ParsedScript`
  - parsed source kind, parsed text, recognized commands, ignored lines
- `InitialPlayerState`
  - inherited state built by replaying earlier chat messages from oldest to newest
- `StageState`
  - internal mutable stage model used during frame building
- `PlayerFrame`
  - renderable frame with background, camera, sprites, speaker, and text

Important behaviors:

- Visual commands mutate stage state but do not emit frames by themselves.
- A `dialogue` command emits a frame from the current flushed stage state.
- If the script has visuals but no dialogue, `buildFrames()` emits one preview frame:
  - `Scene Preview` when the current message had commands
  - `Active Scene` when the message had no commands but inherited visuals exist
- If the last command only changed scene or sprite state, a trailing `Scene Preview` frame is emitted.
- Sprite render order comes from `spriteOrder`; re-showing a character moves it to the top.
- `flush()` clears only transient animation state:
  - pending camera animations
  - one-shot sprite animations (the `animations` field on each `SpriteState`)
- `getInitialState()` also calls `flush()` so one-shot history animations do not leak into frame 0 of the current message.

### Inheritance

- Current-message frames inherit by replaying earlier chat messages, not by semantic diffing.
- Background name and segment persist across messages.
- `scene <background>` without a segment reuses the previous segment.
- Camera transform persists until cleared by bare `camera` or replaced by another transform.
- Camera animation does not persist after `flush()`.
- Explicit outfits are remembered even when the character is hidden.
- `hide` removes the visible sprite but does not forget the remembered outfit.

## Status Macro

- Registered as `{{vn_state}}` via `registerPlayerStatusMacro()` in `status-macro.ts`.
- Tracks `GENERATION_STARTED`/`ENDED` to distinguish regenerations from normal generation.
- Replays chat history backwards through `getInitialState()`, then formats the result with `formatPlayerStatus()`.
- `formatPlayerStatus` output (Ren'Py-style text):
  - `scene <background> [<segment>]` — only if background is set
  - `camera at <transform>` — only if camera transform is set
  - `show <character> in <outfit> <pose> <expression>[ blush] at <position>` — one per visible sprite (`position != null`); falls back to `defaultPose`/`defaultExpression` from settings, and `outfit ?? 'default'`
  - `[offstage]` section — blank-line separated; lists `rememberedOutfits` entries for characters not currently visible; omitted when empty
  - Returns `''` if no background and no visible sprites.

## Asset Resolution

- `assetRoot` is joined using normalized forward-slash paths.
- Candidate URLs are built for every extension in `assetExtensions`, in listed order.
- `SmartImage.vue` tries candidates in order and displays the first one that resolves.

### Backgrounds

- Directory: `<assetRoot>/bg`
- Base name:
  - `<background>-<segment>` when a segment exists
  - `<background>` otherwise
- Example:
  - `scene living_room night`
  - candidates: `<assetRoot>/bg/living_room-night.png`, `.jpg`, `.jpeg`, `.webp`, etc.

### Sprites

Sprites use the `outfit_pose` layout with a pose fallback chain:

- The full candidate list is built upfront by iterating a deduplicated, ordered pose directory list and combining it with the expression base names. `SmartImage` then tries candidates in order until one resolves — the player does not check individual directories before building the list.
- Pose directory order (up to 8 total, deduplicated): `wantedPose` → `defaultPose` → each entry in `poseTokens`
- Each pose directory tried: `<assetRoot>/<character>/<outfit>/<poseCandidate>`
- Base name order within each directory:
  - blush: `<expression>-blush`, then `<expression>`
  - non-blush: `<expression>`

Other notes:

- Character, outfit, pose, expression, background, and segment are lowercased when building paths.
- `blush` changes only candidate order. If `*-blush` is missing, the non-blush asset is still accepted.
- Missing assets do not stop frame construction.
- Prefer preprocessing sprite packs so exported poses already share the same bottom anchor; the player no longer applies per-character or per-pose runtime offsets.

## Settings That Matter

Only settings that affect parsing, frame building, asset lookup, or playback behavior are listed here.

### Parse And Asset Build

- `assetRoot`
- `assetExtensions`
- `defaultPose`
- `defaultExpression`
- `globalPoseTokens`
- `characterSpriteConfig`
  - supported fields: `defaultOutfit`, `poseTokens`, `referenceHeight`
  - keys starting with `_` are ignored
  - invalid entries are partially sanitized instead of throwing
  - unknown fields are ignored

Defaults:

- `assetRoot = ''`
- `assetExtensions = 'png,jpg,jpeg,webp'`
- `defaultPose = 'base'`
- `defaultExpression = 'neutral'`
- `globalPoseTokens = 'base,burst,lean,sit,stand'`
- `spriteReferenceHeight = 2000`

### Presentation And Playback

- Viewport:
  - `stageHeight` (default 480, range 200–1200) — viewport height in px; width is derived as `stageHeight * 16 / 9`
- Camera framing:
  - `defaultBackgroundScale`, `defaultSpriteScale`, `defaultSpriteY`
  - `mediumBackgroundScale`, `mediumSpriteScale`, `mediumSpriteY`
  - `closeupBackgroundScale`, `closeupSpriteScale`, `closeupSpriteY`
- Sprite placement:
  - `spriteCenterX`
  - `spriteSideSpacing`
  - `spriteReferenceHeight`
  - per-character `referenceHeight`
  - camera `spriteY` is translated before scale in the transform list, so its screen-space shift stays stable and is not multiplied by `--sprite-normalize-scale`
- Timing and transitions:
  - `cameraTransitionMs`
  - `sceneTransitionMs`
  - `expressionChangeMs`
  - `poseChangeMs`
  - `spriteEnterMs`
  - `spriteExitMs`
  - `spriteVisibilityEffect`
- Dialogue reveal:
  - `textSpeedMs` (default 30) — delay between each grapheme; 0 = instant
  - `textFadeMs` (default 120) — per-character opacity transition duration
  - `sentencePauseMs` (default 400) — extra delay after sentence-ending punctuation
  - `commaPauseMs` (default 150) — extra delay after clause/comma punctuation
  - `speakerFadeMs` (default 250) — speaker name opacity transition on speaker change
  - `speakerLeadInMs` (default 120) — pause after speaker intro before typing starts
  - `autoAdvanceDelayMs` (default 2500) — wait after reveal finishes before autoplay advances; replaces deprecated `autoPlayDelayMs`
- Message selection and playback:
  - `followLatestPlayable` — when `true`, the controller auto-selects the latest message containing parseable commands; when `false`, uses `preferredMessageId`
  - `preferredMessageId` — written by both the settings panel (user input) and the controller (auto-selection when `followLatestPlayable` is true)
  - `autoPlayDelayMs` — deprecated; kept in schema for backward compatibility but no longer read by the controller

### Persistence

- Settings are stored in script variables under the current script id.
- Persistence pattern:
  1. On store creation: `getVariables({ type: 'script', script_id })` → `SettingsSchema.parse()` for validation/repair → `ref()`
  2. On every change: `watch({ deep: true })` → `klona(value)` → `insertOrAssignVariables()`
- `klona()` is required to strip Vue's Proxy layer before writing to Tavern Helper APIs. Without it, Vue's reactive Proxy causes serialization issues.
- Invalid persisted values are repaired field-by-field using schema defaults rather than rejected wholesale.
- `preferredMessageId` accepts numeric input and normalizes empty/null to `null`.
- Both Vue apps share a single Pinia instance (created in `index.ts`), so settings changes from `SettingsPanel.vue` are immediately visible in the player.

## Runtime Behavior

- Effects disabled (`effectsDisabled`):
  - `effectsDisabled = prefersReducedMotion || motionMode === 'instant'`
  - When true, all transition durations are zeroed: camera, scene fade, sprite enter/exit, sprite swap, and dialogue reveal (instant full text + no per-char fade).
  - `motionMode` is set to `'instant'` by `applyManualMessageId()` (manual message jumps) and by `setMotionModeForNav()` when navigating to an earlier frame index (step backward, jump to start).
  - `motionMode` resets to `'normal'` when navigating forward.

- Scene transitions:
  - `next.isNewScene` triggers fade-to-black behavior in `useScenePresentation()`
  - if `sceneTransitionMs <= 0`, scene changes apply immediately
  - otherwise background swaps at midpoint and sprites reappear at the end
  - the fade div's animation duration is bound to `sceneTransitionMs` via `sceneFadeStyle`

- Camera:
  - `cameraTransform` controls computed background scale, sprite scale, and sprite Y translation
  - transition duration comes from `cameraTransitionMs`
  - `shake` becomes a one-frame class on the scene layer

- Sprite visibility:
  - enter/exit effects currently support `fade` and `none`
  - enter/leave visibility uses `element.animate()` in `player-composables.ts`, not CSS transitions
  - durations are zeroed during scene transitions and when `effectsDisabled` is true

- Sprite swap timing (`getSpriteSwapDuration`):
  - returns 0 when `effectsDisabled` is true, or when the asset description is unchanged
  - pose or outfit change → `poseChangeMs`
  - expression or blush change (no pose change) → `expressionChangeMs`
  - asset changed but pose, outfit, expression, and blush all compare equal → falls back to `poseChangeMs`

- Sprite normalization:
  - natural height is recorded the first time `onSpriteResolved` fires for a given sprite id; subsequent resolves for the same id are ignored
  - normalization scale = `referenceHeight / naturalHeight`

- Dialogue reveal (`useDialogueReveal`):
  - Exposes: `graphemes`, `revealedCharCount`, `speakerRevealed`, `isRevealing`, `isFullyRevealed`, `skipReveal()`, `clearReveal()`
  - Text is split into graphemes using `Intl.Segmenter` (with `Array.from` fallback)
  - Typewriter reveal: each grapheme becomes visible after `textSpeedMs` + optional punctuation pause
  - Punctuation sets:
    - sentence enders: `. ! ? … 。 ！ ？` → `sentencePauseMs` delay
    - clause marks: `, ; : 、 ； ： —` → `commaPauseMs` delay
  - Speaker intro: when the speaker changes relative to the previous frame (and is non-empty), the speaker name fades in over `speakerFadeMs`, then waits `speakerLeadInMs` before typing starts
  - Speaker intro is skipped when speaker is empty or unchanged
  - Fade tail: after the last grapheme becomes visible, waits `textFadeMs` before setting `isFullyRevealed = true`
  - `isFullyRevealed` includes the fade tail; autoplay gates on this value
  - Textless frames (no text or empty string) are immediately "fully revealed" to prevent autoplay deadlocks
  - Timer cancellation uses a generation counter (`revealGeneration`); every scheduled callback checks its captured generation before mutating state
  - `skipReveal()` reveals all graphemes and speaker instantly, still schedules fade tail
  - `clearReveal()` resets everything and increments generation (called on backward nav, unmount, and `cancelAllEffects()`)
  - Watch on `effectsDisabled` defensively completes any in-progress reveal when it becomes `true`
  - CSS variables `--renpy-text-fade-ms` and `--renpy-speaker-fade-ms` control per-char and speaker opacity transitions in the stylesheet; zeroed when `effectsDisabled`
  - `ViewportOverlay.vue` renders text as individual `<span>` elements keyed by index with `renpy-player__char--visible`/`--hidden` classes; speaker uses `renpy-player__speaker--visible`/`--hidden`
  - Controller exposes `dialogue.graphemes`, `dialogue.revealedCharCount`, `dialogue.speakerRevealed`, `dialogue.isRevealing` in the public API

- Autoplay:
  - gate-based scheduling using `canAutoAdvanceNow` (requires `isFullyRevealed`, `!isSceneTransitioning`, not on last frame)
  - when the gate opens, schedules a single timeout for `autoAdvanceDelayMs` to call `stepForward()`
  - cancels pending timeout if the gate closes (e.g. scene transition starts or reveal restarts)
  - stops at the last frame
  - total time per frame = typing time + punctuation pauses + fade tail + `autoAdvanceDelayMs`

- Stage click:
  - does nothing if `!hasFrames` or `isSceneTransitioning`
  - stops autoplay if active (priority 1)
  - skips dialogue reveal if revealing (priority 2)
  - otherwise advances one frame

## SillyTavern CSS Integration

The SCSS reads SillyTavern host-page CSS custom properties for theme-aware styling. These are **not** defined by the renpy-player — they come from SillyTavern's theme engine and are available on the host page:

- `--SmartThemeBorderColor` — theme border color
- `--SmartThemeQuoteColor` — theme quote/accent color
- `--black30a`, `--white30a` — semi-transparent black/white

The stylesheet uses `color-mix(in srgb, ...)` to blend these with transparency. Internal CSS variables (`--renpy-*`, `--sprite-*`) are set by the controller via inline `stageStyle` and `spriteStyle` computeds, not in the SCSS.

## Sharp Edges

- This is not a general Ren'Py parser. Keep assumptions narrow.
- This is a **script** module (no `index.html`). Do not treat it as an iframe-rendered frontend UI project.
- **Do not use tailwindcss** — it will collide with SillyTavern's class names on the host page. Use BEM-prefixed `renpy-player__` classes in unscoped SCSS.
- Vue/Pinia/Zod helpers such as `ref`, `computed`, `watch`, `onMounted`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `storeToRefs`, `z`, and `klona` are auto-imported. Tavern Helper APIs are host-page globals. Match the existing style unless the build config changes.
- `klona()` must wrap any reactive value before passing to `insertOrAssignVariables()` or other Tavern Helper APIs — Vue's Proxy layer causes serialization issues otherwise.
- `ensurePlayerHost()` must be called on `CHAT_CHANGED` because SillyTavern rebuilds the chat DOM.
- Only the first fenced code block gets special priority. Later fenced blocks are only considered when parsing falls back to the whole message.
- `show` only treats `at ...` as valid when it is the trailing clause.
- `in <outfit>` and `blush` are extracted before remaining tokens are interpreted as pose/expression.
- When 2+ remaining tokens are present after parsing a `show`, only the first two are used.
- `TransitionGroup` keys sprites by `renderKey = sprite.id` (currently the character id). Re-showing the same character usually updates the existing DOM node instead of recreating it, so enter/leave hooks only fire for genuinely added or removed characters.
- `SceneLayer` renders `displayedBackground` and `displayedSprites` (the presentation layer managed by `useScenePresentation`), not `currentFrame` directly. These can differ during scene transitions.
- Rendering can proceed even when asset candidates do not resolve.
- Diagnostics in `DiagnosticsPanel.vue` are a convenience view, not a spec.

## When Editing This Module

Update these files together when behavior changes:

- `parser.ts`
  - grammar, token resolution, ignored-line behavior, state rules, frame-building rules
- `types.ts`
  - shared command, asset, frame, and state contracts
- `settings.ts`
  - schema/default/persistence changes
- `useRenpyPlayerController.ts`
  - playback, selection, rendering, presentation behavior, lifecycle, tavern event wiring
- `player-composables.ts`
  - scene transition timing in `useScenePresentation()`
  - visibility effects in `useSpriteVisibilityTransitions()`
  - dialogue reveal in `useDialogueReveal()`
  - autoplay in `useAutoplay()` (gate-based, reveal-aware)
- `SceneLayer.vue`
  - scene rendering template (background, fade, sprites, transitions)
- `ViewportOverlay.vue`
  - HUD template (grapheme-span dialogue bar, speaker reveal, transport controls, message stepper, frame counter)
- `DiagnosticsPanel.vue`
  - diagnostics UI template
- `SmartImage.vue`
  - candidate fallback order, swap behavior, and `resolved` metadata
- `status-macro.ts`
  - macro registration, output format, offstage filtering
- `renpy-player.scss`
  - all player styles; no `:deep()` — use descendant selectors
  - `renpy-player__char--visible`/`--hidden` (per-char opacity via `--renpy-text-fade-ms`)
  - `renpy-player__speaker--visible`/`--hidden` (speaker opacity via `--renpy-speaker-fade-ms`)
- `player-context.ts`
  - only when the controller type or injection mechanism changes

Also update `context.md` whenever implemented behavior changes in a way an agent should know before editing.

# Ren'Py Player Context

Agent-facing context for `src/renpy-player`. Trust this over upstream Ren'Py docs.

## Purpose

Renders a Ren'Py-like VN viewport inside the SillyTavern chat UI from LLM-produced text. This is a *visualizer* for a small command subset embedded in chat messages.

- The **chat** is the interaction surface (swipes/edits/regens/user replies/history).
- The **viewport** just renders the parsed scene + dialogue frames for the selected message.
- By default it follows the **latest message that contains recognized commands**.

Custom script subset only — no branching, variables, ATL, audio, or screen language.

## Typical Workflow

1. User prompts the LLM to include Ren'Py-like commands somewhere in its response (often as a fenced code block).
2. The player auto-selects the latest “playable” message (or a manually selected message id).
3. The parser extracts supported lines from that message and renders frames in the viewport.
4. Earlier messages are replayed to compute **inherited stage state** (background/sprites/outfits/camera).

## Runtime Environment

- **Module type**: Tavern Helper **script** (only `index.ts`, no `index.html`). Mounts Vue apps directly onto the SillyTavern host page via jQuery — not inside an iframe UI.
- **jQuery scope**: `$` operates on the host page (`window.$ = window.parent.$`), so `$('#chat')` selects the real chat element.
- **Style teleportation**: Styles compiled in the background iframe don't reach the host page. `teleportStyle()` copies compiled `<style>` elements into the host `<head>`. This is why the module uses unscoped SCSS with BEM `renpy-player__` classes — **no tailwindcss** (class collisions with SillyTavern).
- **Lifecycle**: Init in `$(() => { ... })` (not `DOMContentLoaded`). Cleanup via `$(window).on('pagehide', ...)` (not `'unload'`).
- **DOM mounting**:
  - `createScriptIdDiv()` creates `<div script_id="...">` for Tavern Helper scoped management.
  - Player host: `attr('id', 'th-renpy-player')`, inserted before `$('#chat')`. Must re-attach on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED` (SillyTavern rebuilds chat DOM).
  - Settings host: appended to `#extensions_settings2`.
  - Single `createPinia()` in `index.ts`, shared by both apps via `.use(pinia)`.

## Build System & Auto-Imports

**Auto-imported (no import statement):**
- Vue Composition API: `ref`, `computed`, `watch`, `watchEffect`, `onMounted`, `onScopeDispose`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `storeToRefs`, `inject`, `provide`, `reactive`, `readonly`, etc.
- `z` (Zod root namespace)
- `klona` (deep-clone; required before any `insertOrAssignVariables()` call — Vue Proxy causes serialization issues)
- VueUse functions from `@vueuse/core`

**Require explicit import:** local modules (`./parser`, `./types`, etc.), `@util/script` utilities, `.vue` components.

**Build constraints:**
- Options API disabled (`__VUE_OPTIONS_API__ = false`). Always use `<script setup lang="ts">`.
- Path alias: `@util/` → project-root `util/`.

## Tavern Helper Globals

Ambient globals — no import needed. Typed in `@types/function/` and `@types/iframe/`.

| Global | Purpose |
|---|---|
| `getChatMessages(id)` | Fetch messages by ID, range (`'0-5'`), or negative depth (`-1` = latest). Returns `ChatMessage[]`; `[0]` may be `undefined`. |
| `getLastMessageId()` | Highest message ID (0-based) in current chat. |
| `getVariables({ type, script_id })` | Read script-scoped variables. |
| `insertOrAssignVariables(obj, target)` | Write/merge variables. Always `klona()` reactive values first. |
| `getScriptId()` | Unique ID string of this script. |
| `eventOn(eventType, cb)` | Subscribe to an event. Returns `{ stop }`. |
| `tavern_events` | Event name constants. Full catalog in `@types/iframe/event.d.ts`. |
| `iframe_events` | Event name constants for helper-side `generate()` calls (not ST chat generation). |
| `registerMacroLike(regex, replacer)` | Register a prompt macro. Returns `{ unregister }`. |

**ChatMessage shape:** `{ message_id: number, name, role, is_hidden, message: string, data, extra }`

### Event Callback Signatures

| Event | Callback |
|---|---|
| `CHAT_CHANGED` | `(chat_file_name: string) => void` |
| `MESSAGE_RECEIVED` | `(message_id: number, type: string) => void` |
| `MESSAGE_EDITED` / `MESSAGE_UPDATED` / `MESSAGE_DELETED` / `MESSAGE_SWIPED` | `(message_id: number) => void` |
| `MORE_MESSAGES_LOADED` | `() => void` |
| `GENERATION_STARTED` | `(type: string, option: object, dry_run: boolean) => void` |
| `GENERATION_STOPPED` | `() => void` |
| `GENERATION_ENDED` | `(message_id: number) => void` |

#### Important: `tavern_events.GENERATION_STARTED` includes dry runs

SillyTavern emits `tavern_events.GENERATION_STARTED` not only for the visible assistant reply,
but also for internal/background pipeline runs such as prompt building / token counting.
Those runs can appear immediately after a normal generation ends and often have:

- `dry_run: true`

Player logic that wants "streaming message is incomplete" behavior (e.g., safe-frame lock)
**must ignore `dry_run` generations**, otherwise the UI will incorrectly re-enter "generation in progress"
after the visible reply is finished.

Also note `GENERATION_STOPPED` is a distinct event (user abort) and should be treated as an "end" for lock cleanup.

## File Map

| File | Role |
|---|---|
| `index.ts` | Mounts apps, registers `teleportStyle()`, wires `pagehide` cleanup |
| `App.vue` | Creates controller, provides it, renders `<PlayerStage />` |
| `PlayerStage.vue` | Stage div with click handler; renders `<SceneLayer />` + `<ViewportOverlay />` |
| `SceneLayer.vue` | Background `SmartImage`, scene fade div, gradient, sprite `TransitionGroup` (enter/leave hooks) |
| `ViewportOverlay.vue` | HUD: dialogue bar (grapheme spans, `displayedSpeaker`), transport controls, message stepper, `<DiagnosticsPanel />` |
| `SmartImage.vue` | Candidate waterfall loading, swap crossfade, `resolved` emit |
| `DiagnosticsPanel.vue` | `<details>` diagnostics UI |
| `SettingsPanel.vue` | Settings UI only |
| `useRenpyPlayerController.ts` | Orchestration: store wiring, frame/message selection, stage geometry, dialogue wiring, lifecycle, event handlers. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`. `dialogue.displayedSpeaker` replaces old `visibleSpeaker` |
| `player-composables.ts` | `useScenePresentation`, `useSpriteVisibilityTransitions`, `useDialogueReveal`, `useAutoplay`, `useReducedMotion`. `useDialogueReveal` exposes `displayedSpeaker` (reactive ref, managed independently from reveal timing) |
| `player-context.ts` | `InjectionKey` + `useRenpyPlayer()` inject helper |
| `parser.ts` | Grammar, token resolution, `StageState`, `buildFrames()`, `getInitialState()` |
| `types.ts` | Command, asset, frame, and state contracts |
| `settings.ts` | Zod schema, saved-settings repair, character config parsing, Pinia store, persistence wiring |
| `status-macro.ts` | `{{vn_state}}` macro: replays history → formats `InitialPlayerState` as Ren'Py-style text |
| `renpy-player.scss` | All player styles (unscoped, BEM). No `:deep()` — use descendant selectors |
| `context.md` | This file. Update when implemented behavior changes |

## Script Grammar

Line-based. Empty lines, full-line `#`/`//` comments, and trailing inline comments are ignored.

### Source Selection

`parseScriptFromMessage()` prefers the first fenced code block if it contains recognized commands (`source = 'fenced'`); otherwise parses the whole message (`source = 'message'`); else `source = 'none'`.

### Inline Comments

`stripInlineComment()` strips trailing comments outside quotes. `#` always starts a comment. `//` only starts a comment at start-of-line or after whitespace (so `chinami//comment` and URLs are preserved). Full-line comments are fast-pathed before stripping.

### Recognized Forms

```text
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
- **`hide all`**: clears all visible sprites; does not affect background/segment/camera; remembered outfits are preserved.
- **`camera`** / **`camera at`**: allowed camera transforms: `closeup`, `medium` (persistent); `shake` (one-frame). Bare `camera` clears transform + pending animations.
- **`show` `at` clause**: must be last. Allowed transforms — positions: `left`, `center`, `right`; animations: `shake`, `bounce`, `pulse`.
- **Token resolution** (remaining after `in`/`blush` extraction):
  - 2+ tokens → first = pose, second = expression
  - 1 token → pose if in configured `poseTokens`, else expression
  - 0 tokens → inherit current or fall back to defaults
- **Blush persistence**: explicit `blush` sets true; changing expression without `blush` clears it; otherwise carries forward.
- **Say-with-attrs** (`chinami base neutral "Hello"`) emits a `show` command + a `dialogue` command.
- Invalid lines (unsupported transforms, unrecognized forms) go to `ParsedScript.ignoredLines`.

## State & Frames

- Visual commands mutate `StageState` but do not emit frames.
- `dialogue` command emits a frame from the current flushed stage state.
- Scripts with visuals but no dialogue emit a single preview frame (`Scene Preview` / `Active Scene`).
- Trailing visual-only commands emit a `Scene Preview` frame.
- `flush()` clears pending camera animations and one-shot sprite animations only.
- `getInitialState()` replays earlier messages oldest→newest and also calls `flush()` to prevent history animations leaking into frame 0.
- Remembered outfits persist even when a character is hidden.
- Camera transform persists until cleared; camera animation does not.

## Asset Resolution

- `assetRoot` paths use normalized forward slashes.
- Candidates are built for every extension in `assetExtensions` in listed order. `SmartImage` tries in order, uses the first that resolves.

### Backgrounds

Path: `<assetRoot>/bg/<background>[-<segment>].<ext>`

### Sprites

Path: `<assetRoot>/<character>/<outfit>/<poseCandidate>/<expression>[-blush].<ext>`

- **Pose fallback chain** (up to 8, deduplicated): `wantedPose` → `defaultPose` → each entry in `poseTokens`
- **Base name order**: blush → `<expression>-blush`, then `<expression>`; non-blush → `<expression>`
- The full candidate list is built upfront across all pose fallbacks; `SmartImage` iterates it.
- Character, outfit, pose, expression, background, segment are lowercased in paths.
- Missing assets don't stop frame construction.

### Character Config (`characterSpriteConfig`)

Per-character JSON keys: `defaultOutfit`, `poseTokens`, `referenceHeight`. Keys starting with `_` are comments (ignored). Unknown fields are silently dropped.

### Key Defaults

```
assetExtensions = 'png,jpg,jpeg,webp'
defaultPose = 'base'
defaultExpression = 'neutral'
globalPoseTokens = 'base,burst,lean,sit,stand'
spriteReferenceHeight = 2000
stageHeight = 480
```

## Status Macro (`{{vn_state}}`)

Output format (Ren'Py-style text, empty string if no background and no visible sprites):
```
scene <background> [<segment>]
camera at <transform>          ← only if set
show <char> in <outfit> <pose> <expression>[ blush] at <position>
                               ← one per visible sprite
[offstage]
<character>: <outfit>          ← remembered outfits for hidden characters
```
Regenerations/swipes: excludes the current (being-generated) message from history replay.

## Sharp Edges

- **Script module, not iframe UI.** No `index.html`, no tailwindcss, no scoped CSS.
- **`klona()` is mandatory** before `insertOrAssignVariables()` or any Tavern Helper API receiving a reactive value.
- **`ensurePlayerHost()`** must be called on `CHAT_CHANGED` — SillyTavern rebuilds the chat DOM.
- **Generation events include dry runs.**
  `tavern_events.GENERATION_STARTED(type, option, dry_run)` may fire for internal/background runs after a reply completes.
  Any "generation lock" / "exclude incomplete message" logic must ignore `dry_run === true`,
  and should also clear state on `tavern_events.GENERATION_STOPPED`.
- **`at` clause** is only valid as the final clause in `show`/`camera at`.
- **Say-with-attrs emits two commands** — a `show` then a `dialogue`.
- **`TransitionGroup`** keys sprites by `renderKey = sprite.id`. Re-showing the same character updates the existing DOM node; enter/leave hooks only fire for genuine additions/removals.
- **`SceneLayer`** renders `displayedBackground`/`displayedSprites` (presentation layer), not `currentFrame` directly — they can differ during scene transitions.
- **`motionMode = 'instant'`** is set on manual message jumps and backward navigation; resets to `'normal'` on forward navigation.
- **`effectsDisabled`** = `prefersReducedMotion || motionMode === 'instant'` — zeros all transition durations.
- Only the first fenced code block gets parse priority; later blocks are considered only in whole-message fallback.
- **Speaker display** uses `displayedSpeaker` (a reactive ref inside `useDialogueReveal`), not a computed from the current frame. Three-way transition: speaker appears (fade in via `speakerFadeMs`), speaker disappears (fade out, then `displayedSpeaker` clears after `speakerFadeMs`), no change (instant update). Empty/missing speaker → `speakerRevealed = false`. There is no lead-in delay before typing — text reveal starts immediately.

Update this file when implemented behavior changes in a way an agent should know before editing.
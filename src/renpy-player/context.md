# Ren'Py Player Context

Agent-facing context for `src/renpy-player`.

## Purpose

- Renders a small Ren'Py-like visual novel preview inside the Tavern Helper / SillyTavern chat UI.
- Implements a custom script subset defined in `parser.ts` and rendered as `PlayerFrame[]` by `buildFrames()`.
- Does not implement real Ren'Py execution, branching, variables, ATL, audio, menus, labels, jumps, save/load, or screen language.
- If behavior is unclear, trust local source over upstream Ren'Py documentation.

## File Map

### Controller & State

- `useRenpyPlayerController.ts`: orchestration composable — store wiring, message/frame selection, rendered sprite pipeline, stage geometry, lifecycle (`onMounted`/`onScopeDispose`), tavern event subscriptions, autoplay stop + transition cleanup. Exposes grouped API: `model`, `stage`, `scene`, `dialogue`, `transport`, `selection`, `autoplay`, `diagnostics`.
- `player-context.ts`: `InjectionKey<RenpyPlayerController>` + `useRenpyPlayer()` inject helper. All extracted components inject the controller via this module.

### Vue Components

- `App.vue`: thin wrapper — creates controller, provides it, renders `<PlayerStage />`. No logic.
- `PlayerStage.vue`: stage root — renders `<SceneLayer />` + `<ViewportOverlay />` inside the stage div with click handler.
- `SceneLayer.vue`: scene rendering — background `SmartImage`, scene fade div, gradient, sprite `TransitionGroup` with enter/leave hooks.
- `ViewportOverlay.vue`: HUD overlay — empty state, dialogue bar (speaker + text), transport controls, autoplay button, message selection stepper, frame counter. Renders `<DiagnosticsPanel />`.
- `DiagnosticsPanel.vue`: diagnostics `<details>` UI — reads controller.diagnostics, controller.model, controller.scene.
- `SmartImage.vue`: candidate waterfall loading, swap crossfade, `resolved` emit.
- `SettingsPanel.vue`: settings UI only; keep behavior in `settings.ts` or `useRenpyPlayerController.ts`.

### Styles

- `renpy-player.scss`: all styles for the player (unscoped). Imported once from `index.ts`. No `:deep()` usage — descendant selectors target child components directly.

### Supporting Modules

- `parser.ts`: grammar, token resolution, `StageState`, `buildFrames()`, `getInitialState()`
- `types.ts`: shared command, asset, frame, and state contracts
- `settings.ts`: Zod schema, saved-settings repair, character config parsing, Pinia store, persistence wiring
- `player-composables.ts`: scene presentation (`useScenePresentation`), visibility transitions (`useSpriteVisibilityTransitions`), autoplay (`useAutoplay`), reduced-motion handling (`useReducedMotion`)
- `status-macro.ts`: `{{vn_state}}` macro that formats `InitialPlayerState` as Ren'Py-style text for prompt injection
- `index.ts`: mounts `App.vue` into `#th-renpy-player` and `SettingsPanel.vue` into `#extensions_settings2`. Imports `renpy-player.scss` once.
- `context.md`: agent-facing source of truth; update when behavior changes

## Integration

- `index.ts` mounts:
  - `App.vue` into `#th-renpy-player`, inserted before `#chat`
  - `SettingsPanel.vue` into `#extensions_settings2`
- Host-provided globals used by this module:
  - `getChatMessages()`
  - `getLastMessageId()`
  - `getVariables()`
  - `insertOrAssignVariables()`
  - `getScriptId()`
  - `eventOn()`
  - `tavern_events`
  - `registerMacroLike()`
- `getChatMessages(id)[0]` is optional. Treat missing messages as normal when walking history or selecting a message id.
- `index.ts` re-inserts the player host on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED`, and unmounts both apps on `pagehide`.
- `useRenpyPlayerController()` owns lifecycle internally: reduced-motion setup/cleanup, tavern event subscriptions + disposal, autoplay stop + transition cleanup. It uses `onMounted` + `onScopeDispose`.
- The controller recomputes selection on chat-history events such as receive, edit, update, delete, swipe, and load.

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
  - one-shot sprite animations
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

Sprites use the `outfit_pose` layout with pose-directory fallback:

- Primary directory: `<assetRoot>/<character>/<outfit>/<pose>`
- If the primary pose directory has no matching candidate, additional directories are tried in order (up to 8 total):
  `wantedPose` → `defaultPose` → each entry in `poseTokens` (deduplicated, preserving order)
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

### Presentation And Playback

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
- Message selection and playback:
  - `followLatestPlayable`
  - `preferredMessageId`
  - `autoPlayDelayMs`

### Persistence

- Settings are stored in script variables under the current script id.
- Invalid persisted values are repaired field-by-field using schema defaults.
- `preferredMessageId` accepts numeric input and normalizes empty/null to `null`.

## Runtime Behavior

- Scene transitions:
  - `next.isNewScene` triggers fade-to-black behavior in `useScenePresentation()`
  - if `sceneTransitionMs <= 0`, scene changes apply immediately
  - otherwise background swaps at midpoint and sprites reappear at the end
- Camera:
  - `cameraTransform` controls computed background scale, sprite scale, and sprite Y translation
  - transition duration comes from `cameraTransitionMs`
  - `shake` becomes a one-frame class on the scene layer
- Sprite visibility:
  - enter/exit effects currently support `fade` and `none`
  - enter/leave visibility uses `element.animate()` in `player-composables.ts`, not CSS transitions
  - durations are zeroed during scene transitions and when reduced motion is active
- Sprite swap timing:
  - expression-only and blush-only changes use `expressionChangeMs`
  - pose/outfit/silhouette changes use `poseChangeMs`
- Autoplay:
  - advances on an interval using `autoPlayDelayMs`
  - stops at the last frame
  - does not advance while a scene transition is active
- Stage click:
  - pauses autoplay if active
  - otherwise advances one frame when possible

## Sharp Edges

- This is not a general Ren'Py parser. Keep assumptions narrow.
- Vue/Pinia/Zod helpers such as `ref`, `computed`, `watch`, `onMounted`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `storeToRefs`, `z`, and `klona` are auto-imported by the webpack config. Tavern Helper APIs are host-page globals. Match the existing style unless the build config changes.
- Only the first fenced code block gets special priority. Later fenced blocks are only considered when parsing falls back to the whole message.
- `show` only treats `at ...` as valid when it is the trailing clause.
- `in <outfit>` and `blush` are extracted before remaining tokens are interpreted as pose/expression.
- When 2+ remaining tokens are present after parsing a `show`, only the first two are used.
- `TransitionGroup` keys sprites by `renderKey = sprite.id` (currently the character id). Re-showing the same character usually updates the existing DOM node instead of recreating it, so enter/leave hooks only fire for genuinely added or removed characters.
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
  - autoplay in `useAutoplay()`
- `SceneLayer.vue`
  - scene rendering template (background, fade, sprites, transitions)
- `ViewportOverlay.vue`
  - HUD template (dialogue bar, transport controls, message stepper, frame counter)
- `DiagnosticsPanel.vue`
  - diagnostics UI template
- `SmartImage.vue`
  - candidate fallback order, swap behavior, and `resolved` metadata
- `status-macro.ts`
  - macro registration, output format, offstage filtering
- `renpy-player.scss`
  - all player styles; no `:deep()` — use descendant selectors
- `player-context.ts`
  - only when the controller type or injection mechanism changes

Also update `context.md` whenever implemented behavior changes in a way an agent should know before editing.                                                                                                                                                                 
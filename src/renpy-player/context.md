# Ren'Py Player Context

Agent-facing context for `src/renpy-player`.

## Purpose

- Renders a small Ren'Py-like visual novel preview inside the Tavern Helper / SillyTavern chat UI.
- Implements a custom script subset defined in `parser.ts` and rendered as `PlayerFrame[]` by `buildFrames()`.
- Does not implement real Ren'Py execution, branching, variables, ATL, audio, menus, labels, jumps, save/load, or screen language.
- If behavior is unclear, trust local source over upstream Ren'Py documentation.

## File Map

- `parser.ts`: grammar, token resolution, `StageState`, `buildFrames()`, `getInitialState()`
- `types.ts`: shared command, asset, frame, and state contracts
- `settings.ts`: Zod schema, saved-settings repair, character config parsing, Pinia store, persistence wiring
- `player-composables.ts`: scene presentation, visibility transitions, autoplay, reduced-motion handling
- `App.vue`: store wiring, message/frame selection, rendered sprite pipeline, stage geometry, HUD behavior
- `SmartImage.vue`: candidate waterfall loading, swap crossfade, `resolved` emit
- `SettingsPanel.vue`: settings UI only; keep behavior in `settings.ts`, `App.vue`, or `player-composables.ts`
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
- `getChatMessages(id)[0]` is optional. Treat missing messages as normal when walking history or selecting a message id.
- `index.ts` re-inserts the player host on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED`, and unmounts both apps on `pagehide`.
- `App.vue` recomputes selection on chat-history events such as receive, edit, update, delete, swipe, and load.

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

- Layout comes from `characterSpriteConfig[character].layout`, otherwise `defaultSpriteLayout`.

`outfit_pose` layout:

- Directory: `<assetRoot>/<character>/<outfit>/<pose>`
- Base name order:
  - blush: `<expression>-blush`, then `<expression>`
  - non-blush: `<expression>`

`flat` layout:

- Directory: `<assetRoot>/<character>`
- Base name order:
  - blush: `<expression>-blush`, then `<expression>`
  - non-blush: `<expression>`

Other notes:

- Character, outfit, pose, expression, background, and segment are lowercased when building paths.
- `blush` changes only candidate order. If `*-blush` is missing, the non-blush asset is still accepted.
- Missing assets do not stop frame construction.

## Settings That Matter

Only settings that affect parsing, frame building, asset lookup, or playback behavior are listed here.

### Parse And Asset Build

- `assetRoot`
- `assetExtensions`
- `defaultSpriteLayout`
- `defaultPose`
- `defaultExpression`
- `globalPoseTokens`
- `characterSpriteConfig`
  - supported fields: `layout`, `defaultOutfit`, `poseTokens`, `referenceHeight`, `baseOffset`, `poseOffsets`
  - keys starting with `_` are ignored
  - invalid entries are partially sanitized instead of throwing

Defaults:

- `assetRoot = ''`
- `assetExtensions = 'png,jpg,jpeg,webp'`
- `defaultSpriteLayout = 'outfit_pose'`
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
  - per-character `referenceHeight`, `baseOffset`, `poseOffsets`
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
  - `cameraTransform` controls computed background scale, sprite scale, and sprite Y offset
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
- Vue/Pinia/Zod helpers such as `ref`, `computed`, `watch`, `onMounted`, `onBeforeUnmount`, `createApp`, `createPinia`, `defineStore`, `z`, and `klona` are auto-imported by the webpack config. Tavern Helper APIs are host-page globals. Match the existing style unless the build config changes.
- Only the first fenced code block gets special priority. Later fenced blocks are only considered when parsing falls back to the whole message.
- `show` only treats `at ...` as valid when it is the trailing clause.
- `in <outfit>` and `blush` are extracted before remaining tokens are interpreted as pose/expression.
- When 2+ remaining tokens are present after parsing a `show`, only the first two are used.
- `TransitionGroup` keys sprites by `renderKey = sprite.id` (currently the character id). Re-showing the same character usually updates the existing DOM node instead of recreating it, so enter/leave hooks only fire for genuinely added or removed characters.
- Rendering can proceed even when asset candidates do not resolve.
- Diagnostics in `App.vue` are a convenience view, not a spec.

## When Editing This Module

Update these files together when behavior changes:

- `parser.ts`
  - grammar, token resolution, ignored-line behavior, state rules, frame-building rules
- `types.ts`
  - shared command, asset, frame, and state contracts
- `settings.ts` or `App.vue`
  - `settings.ts` for schema/default/persistence changes
  - `App.vue` for playback, selection, rendering, and presentation behavior
- `player-composables.ts`
  - scene transition timing in `useScenePresentation()`
  - visibility effects in `useSpriteVisibilityTransitions()`
  - autoplay in `useAutoplay()`
- `SmartImage.vue`
  - candidate fallback order, swap behavior, and `resolved` metadata
  - `App.vue` uses `resolved.naturalHeight` to normalize sprite scale against configured reference heights

Also update `context.md` whenever implemented behavior changes in a way an agent should know before editing.

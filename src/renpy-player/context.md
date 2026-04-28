# Ren'Py Player Context

This document is for coding agents working on `src/renpy-player`.

## Purpose And Scope

- The module renders a small Ren'Py-like visual novel preview inside the Tavern Helper / SillyTavern chat UI.
- It does not implement real Ren'Py execution, screen language, variables, branching, ATL, audio, menus, labels, jumps, or save/load.
- The supported script language is the custom subset implemented in `parser.ts` and converted into `PlayerFrame[]` by `buildFrames()`.
- When behavior is unclear, treat source code as authoritative. Do not infer behavior from upstream Ren'Py docs.

## Integration Points

- `index.ts` mounts two Vue apps after DOM ready:
  - `App.vue` into `#th-renpy-player`, inserted before `#chat`
  - `SettingsPanel.vue` into `#extensions_settings2`
- The module depends on Tavern Helper / SillyTavern globals and utilities already available in the host page, including:
  - `getChatMessages()`
  - `getLastMessageId()`
  - `getVariables()`
  - `insertOrAssignVariables()`
  - `getScriptId()`
  - `eventOn()`
  - `tavern_events`
- `index.ts` re-inserts the player host on `CHAT_CHANGED` and `MORE_MESSAGES_LOADED`, and unmounts both apps on `pagehide`.
- `App.vue` listens for chat-history events such as message receive/edit/update/delete/swipe/load and recomputes the selected playable message.

## Supported Script Grammar

Parsing is line-based. Empty lines and lines starting with `#` or `//` are ignored.

### Source Selection

- `parseScriptFromMessage()` first checks the first fenced code block.
- If that fenced block contains at least one recognized command, only that block is used and `source = 'fenced'`.
- Otherwise the entire message is parsed and `source = 'message'`.
- If nothing is recognized, `source = 'none'`.

### Recognized Commands

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

Examples that are implemented:

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

### Command Semantics

- `scene <background> [segment]`
  - Matches alphanumeric, `_`, `-` tokens only.
  - `segment` is optional.
  - A new `scene` clears visible sprites, keeps remembered outfits, and sets `isNewScene` for the next emitted frame.
  - If `segment` is omitted, the previous background segment is reused.
- `hide <character>`
  - Removes the visible sprite and its render order entry.
  - Does not clear remembered outfit for that character.
- `camera`
  - Clears the persistent camera transform and any pending camera animations.
- `camera at ...`
  - Allowed transforms: `closeup`, `medium`, `shake`.
  - `closeup` and `medium` are persistent camera transforms.
  - `shake` is a one-frame camera animation.
  - Multiple transforms are allowed, for example `camera at closeup, shake`.
- `show <character> ...`
  - Optional `at` clause must be last.
  - Allowed show transforms: positions `left`, `center`, `right`; animations `shake`, `bounce`, `pulse`.
  - Optional `in <outfit>` selects outfit.
  - Optional `blush` is a keyword, not a generic token.
  - Remaining tokens are resolved into pose/expression:
    - 2+ tokens: first is pose, second is expression
    - 1 token: pose if it matches configured pose tokens, otherwise expression
    - 0 tokens: reuse current pose/expression or fall back to defaults
- Say-with-attributes lines like `chinami base neutral "Hello"` emit:
  - one `show` command using the speaker as the character id
  - one `dialogue` command
- Dialogue line `speaker "text"` emits dialogue only.
- Bare quoted text emits narrator dialogue.

### Ignored Lines

- Invalid lines are collected in `ParsedScript.ignoredLines`.
- A line is ignored if it does not match any recognized form.
- A `show` line is ignored if its `at` clause contains an unsupported transform or an empty transform list.
- A `camera at` line is ignored if any transform is unsupported or the list is empty.
- Only exact quoted dialogue forms are recognized; unquoted free text is ignored.

## State And Frame Model

- `ParsedScript`
  - `source`: `fenced`, `message`, or `none`
  - `scriptText`: the text that was actually parsed
  - `commands`: recognized commands in order
  - `ignoredLines`: unrecognized or invalid lines
- `InitialPlayerState`
  - Built by replaying earlier chat messages from oldest to newest with `getInitialState()`
  - Carries inherited background, background segment, camera transform, visible sprites, and remembered outfits into the current message
- `StageState`
  - Internal mutable state used by `buildFrames()`
  - Tracks current background, camera transform, pending camera animation, visible sprites, sprite z-order, and remembered outfits
- `PlayerFrame`
  - A renderable VN frame with background, camera, sprites, speaker, and text
  - `sprites` are emitted in DOM order; later entries are visually on top
  - Re-showing a character moves it to the top because its id is moved to the end of sprite order

### Frame Emission Rules

- Visual commands (`scene`, `show`, `hide`, `camera`) mutate stage state but do not emit frames by themselves.
- A `dialogue` command emits a frame using the current flushed stage state.
- If the script has visuals but no dialogue, one preview frame is emitted:
  - `Scene Preview` if the current message had commands
  - `Active Scene` if the message had no commands but inherited visuals exist
- If the final command only changed scene/sprite state after the last dialogue, a trailing `Scene Preview` frame is emitted.
- `flush()` clears one-shot sprite animations and pending camera animations after the frame is emitted.

### Inheritance Rules

- Current-message frames inherit from earlier chat messages by replaying prior commands.
- Background name and segment persist across messages.
- `scene <background>` without a segment reuses the previous segment.
- Camera transform persists until cleared by bare `camera` or replaced by another camera transform.
- Camera animation does not persist after a flush.
- Explicit outfit selection is remembered per character even when the character is hidden.
- `hide` removes the visible sprite but does not forget the remembered outfit.

## Asset Resolution

- `assetRoot` is joined with normalized forward-slash paths.
- Candidate URLs are built for every extension in `assetExtensions`, in listed order.
- `SmartImage.vue` tries candidates in order and displays the first one that loads.

### Backgrounds

- Directory: `<assetRoot>/bg`
- Base name:
  - `<background>-<segment>` when a segment exists
  - `<background>` otherwise
- Example:
  - `scene living_room night`
  - candidates: `<assetRoot>/bg/living_room-night.png`, `.jpg`, `.jpeg`, `.webp`, etc.

### Sprites

- Layout is resolved per character from `characterSpriteConfig[character].layout`, otherwise `defaultSpriteLayout`.

`outfit_pose` layout:

- Directory: `<assetRoot>/<character>/<outfit>/<pose>`
- Base names:
  - blush: `<expression>-blush`, then fallback `<expression>`
  - non-blush: `<expression>`

`flat` layout:

- Directory: `<assetRoot>/<character>`
- Base names:
  - blush: `<expression>-blush`, then fallback `<expression>`
  - non-blush: `<expression>`

Other asset notes:

- Character, outfit, pose, expression, background, and segment are lowercased when generating asset paths.
- `blush` only affects the asset candidate order; if `*-blush` is missing, the non-blush asset is still accepted.
- Missing assets do not stop frame construction; the frame can exist with unresolved candidates.

## Settings Contract

This section only covers settings that materially affect parsing, frame building, asset lookup, or playback behavior.

### Parse And Asset-Build Inputs

- `assetRoot`
  - Base path or URL for all background and sprite candidates
  - default: `''`
- `assetExtensions`
  - Comma-separated extension list used in candidate order after trimming and removing leading dots
  - default: `png,jpg,jpeg,webp`
- `defaultSpriteLayout`
  - Global fallback sprite layout: `outfit_pose` or `flat`
  - default: `outfit_pose`
- `defaultPose`
  - Fallback pose token
  - default: `base`
- `defaultExpression`
  - Fallback expression token
  - default: `neutral`
- `globalPoseTokens`
  - Comma-separated tokens used to disambiguate one-token `show` commands
  - default: `base,burst,lean,sit,stand`
- `characterSpriteConfig`
  - JSON object keyed by character id
  - supports:
    - `layout`
    - `defaultOutfit`
    - `poseTokens`
    - `referenceHeight`
    - `baseOffset`
    - `poseOffsets`
  - keys starting with `_` are ignored
  - invalid entries are partially sanitized instead of throwing

### Presentation And Playback Inputs

- Camera framing:
  - `defaultBackgroundScale`, `defaultSpriteScale`, `defaultSpriteY`
  - `mediumBackgroundScale`, `mediumSpriteScale`, `mediumSpriteY`
  - `closeupBackgroundScale`, `closeupSpriteScale`, `closeupSpriteY`
- Sprite placement:
  - `spriteCenterX`
  - `spriteSideSpacing`
  - `spriteReferenceHeight`
  - per-character `referenceHeight`, `baseOffset`, `poseOffsets`
- Transitions and timing:
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

### Persisted Settings Behavior

- Settings are stored in script variables under the current script id.
- Invalid persisted values are repaired field-by-field using schema defaults.
- `preferredMessageId` accepts numeric input, empty/null as `null`, and is normalized before storage.

## Animation And Scene Behavior

- Scene changes:
  - `next.isNewScene` triggers fade-to-black behavior in `useScenePresentation()`
  - if `sceneTransitionMs <= 0`, scene changes apply immediately
  - otherwise background swaps at midpoint and sprites reappear at the end
- Camera:
  - `cameraTransform` affects computed background scale, sprite scale, and sprite Y offset
  - camera transform transition duration comes from `cameraTransitionMs`
  - `shake` is exposed as a one-frame class on the scene layer
- Sprite enter/exit:
  - enter/exit visibility effects currently support `fade` and `none`
  - durations are zeroed during scene transitions or when `prefers-reduced-motion` is enabled
- Sprite swap timing:
  - expression-only and blush-only changes use `expressionChangeMs`
  - pose/outfit/silhouette changes use `poseChangeMs`
- Autoplay:
  - advances frames on an interval using `autoPlayDelayMs`
  - stops at the last frame
  - does not advance while a scene transition is active
- Stage click behavior:
  - click pauses autoplay if active
  - otherwise click advances one frame when possible

## Non-Goals And Sharp Edges

- This is not a general Ren'Py parser. Supported syntax is intentionally narrow.
- Only the first fenced code block gets special priority. Later fenced blocks are only seen when the parser falls back to whole-message parsing.
- `show` parsing only treats `at ...` as valid when it is the trailing clause.
- `in <outfit>` and `blush` are extracted before remaining tokens are interpreted as pose/expression.
- When 2+ remaining tokens are present after parsing a `show`, only the first two are used.
- Message-history inheritance is command replay, not semantic diffing. If behavior depends on history, inspect `getInitialState()` and `StageState`.
- Rendering can proceed even when asset candidates do not resolve.
- Diagnostics in `App.vue` are a convenience view, not a spec.

## When Editing This Module

Update these files together when behavior changes:

- `parser.ts`
  - grammar, token resolution, ignored-line behavior, frame/state rules
- `types.ts`
  - command/frame/state contracts consumed across the module
- `settings.ts` or `App.vue`
  - `settings.ts` for schema/default/persistence changes
  - `App.vue` for playback, selection, rendering, and presentation behavior

Also update this `context.md` whenever implemented behavior changes in a way an agent would need to know before editing.

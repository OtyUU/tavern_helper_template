# VN Player

A visual novel player that renders Ren'Py-like scenes inside the SillyTavern chat. It parses a lightweight script from chat messages and displays backgrounds, character sprites, and dialogue in a 16:9 viewport above the chat.

## Writing Scripts

The player reads script commands embedded in chat messages. Commands can be placed either in a fenced code block or directly in the message text.

If the first fenced code block contains at least one recognized command, only that block is parsed. Otherwise the entire message text is scanned.

Lines starting with `#` or `//` are ignored. Empty lines are also ignored.

### Commands

| Command | Description |
|---------|-------------|
| `scene <bg> [segment]` | Change the background. Clears all visible sprites. `segment` is optional (e.g. `day`, `night`). Omitting segment reuses the previous one. |
| `show <character> [pose] [expression]` | Show or update a character sprite, optionally updating pose and/or expression. |
| `show <character> in <outfit>` | Show a character wearing a specific outfit. Can be combined with pose, expression, blush, and at. |
| `show <character> ... blush` | Add blush to the current expression. |
| `show <character> ... at <pos>` | Place the character at a position: `left`, `center`, or `right`. |
| `show <character> ... at <anim>` | Play a one-shot sprite animation: `shake`, `bounce`, or `pulse`. |
| `show <character> ... at <pos>, <anim>` | Combine position and animation in one `at` clause. |
| `hide <character>` | Remove a character from the scene. Remembered outfit is kept. |
| `camera` | Reset the camera to the default framing. |
| `camera at <transform>` | Apply one or more camera transforms (comma-separated): `closeup`, `medium`, `shake`. |
| `<character> "text"` | Display dialogue from a character. Sprite is unchanged. |
| `<character> [pose] [expression] "text"` | Update sprite and show dialogue in one line. |
| `"text"` | Narrator dialogue (no character name). |

`closeup` and `medium` are persistent camera transforms — they stay active until overridden or cleared by a bare `camera`. `shake` is a one-shot animation that does not persist.

The `in <outfit>`, `blush`, and `at` clauses can be combined freely with pose/expression tokens on the same `show` line. `at` must always be the last clause.

### Examples

```renpy
scene living_room night
show chinami base neutral
chinami base neutral "Welcome to the cafe."
show chinami base smile
chinami "Would you like some tea?"
show eileen in uniform happy at left
eileen "I'd love one!"
camera at closeup
chinami base blush "I made it just for you..."
hide eileen
camera
```

```renpy
scene school_hallway
show chinami base neutral at center
chinami "The hallway is empty."
camera at medium, shake
chinami base surprised "W-What was that?!"
```

```renpy
# Combining position and animation in one at clause
show chinami base smile at left, bounce
chinami "Good morning!"
```

### Sprite Resolution

When a `show` command (or a say-with-attributes line) has tokens between the character name and any keywords (`in`, `blush`, `at`):

- **2+ tokens**: first = pose, second = expression. Extra tokens are ignored.
- **1 token**: treated as pose if it matches a configured pose token, otherwise as expression.
- **0 tokens**: reuses the current pose and expression, falling back to defaults.

### Blush Behavior

- Writing `blush` explicitly always turns blush on.
- Changing the expression without writing `blush` turns blush off.
- Keeping the same expression (or using 0-token show) preserves the current blush state.

---

## Asset Folder Structure

Set **Asset root URL/path** in settings to the base directory containing your images.

### Backgrounds

```
<assetRoot>/bg/<background>-<segment>.png
<assetRoot>/bg/<background>.png
```

Example: `scene living_room night` tries `<assetRoot>/bg/living_room-night.png`, then `.jpg`, `.jpeg`, `.webp`, etc. (in the order configured under Asset extensions).

### Character Sprites

Sprites use the `outfit_pose` layout:

```
<assetRoot>/<character>/<outfit>/<pose>/<expression>.png
<assetRoot>/<character>/<outfit>/<pose>/<expression>-blush.png
```

All path components are lowercased automatically. The player tries each configured file extension in order and uses the first one that loads. For blush, the `-blush` variant is tried first; if it is missing, the non-blush asset is used as a fallback. Missing assets do not break rendering.

---

## Player Controls

The player appears above the chat as a 16:9 viewport with a control bar:

- **Restart** — jump back to the first frame of the current script.
- **Previous** — go back one frame.
- **Jump to latest** — switch to the newest message that contains script commands and re-enable automatic tracking.
- **Autoplay / Pause** — automatically advance frames at the configured interval. Stops at the last frame.
- **Message stepper** — type a message ID directly, or use the − / + buttons to step through messages. Selecting a message manually disables automatic tracking until you press Jump to latest again.
- **Frame counter** — shows the current position (e.g. `2 / 5`).
- **Click the stage** — pauses autoplay if it is running; otherwise advances one frame.
- **Diagnostics panel** (ⓘ icon, top-left) — shows the active background candidates, per-sprite asset candidates, normalization scales, camera state, and any JSON config errors.

---

## Settings

Open the **VN Player** panel in SillyTavern's extension settings area.

### Assets

| Setting | Description | Default |
|---------|-------------|---------|
| Asset root URL/path | Base URL or local path for all images. | *(empty)* |
| Asset extensions | Comma-separated extensions tried in order for both sprites and backgrounds. | `png,jpg,jpeg,webp` |

### Playback

| Setting | Description | Default |
|---------|-------------|---------|
| Stage height (px) | Viewport height in pixels. Width is always `height × 16/9`. Black bars appear when the panel is wider than that. | `480` |
| Autoplay delay (ms) | Milliseconds between auto-advanced frames. | `2500` |
| Follow latest playable | Automatically track the newest message containing script commands. | on |

### Animations

| Setting | Description | Default |
|---------|-------------|---------|
| Camera transition (ms) | Duration of camera movement for `closeup`, `medium`, and return-to-default. | `350` |
| Scene transition (ms) | Fade-to-black duration when changing backgrounds with `scene`. | `600` |
| Expression change (ms) | Crossfade duration for expression-only or blush-only sprite changes. | `160` |
| Pose change (ms) | Dissolve duration for pose or outfit changes. | `90` |
| Sprite enter (ms) | Fade-in duration when a character first appears. | `160` |
| Sprite exit (ms) | Fade-out duration when a character is hidden or cleared. | `160` |
| Visibility effect | `fade` for animated enter/exit, or `none` for instant show/hide. | `fade` |

All animation durations are automatically zeroed when the OS `prefers-reduced-motion` flag is active.

### Camera Presets

Three presets control how the background and sprites are framed. Each preset exposes three fields:

| Field | Description |
|-------|-------------|
| Background scale | Uniform scale applied to the background image. |
| Sprite scale | Uniform scale applied to all sprites. |
| Sprite Y (%) | Vertical offset applied to sprites, as a percentage of stage height. Positive values move sprites down. |

| Preset | Background scale | Sprite scale | Sprite Y |
|--------|-----------------|--------------|----------|
| Default | `1.0` | `1.0` | `0` |
| Medium | `1.2` | `1.3` | `0` |
| Closeup | `1.5` | `1.8` | `0` |

Two additional placement settings apply globally:

| Setting | Description | Default |
|---------|-------------|---------|
| Sprite center X (%) | Horizontal anchor for sprites without an explicit `at` position. | `50` |
| Left/right spacing (%) | How far `left` and `right` positions sit from the center anchor. | `22` |

### Character Layouts

| Setting | Description | Default |
|---------|-------------|---------|
| Sprite reference height (px) | Baseline canvas height used to normalize sprite sizes. Characters without a per-character override use this value. Taller source canvases render proportionally taller. | `2000` |
| Character sprite config JSON | Per-character overrides (see below). | `{}` |
| Default pose token | Fallback pose name when a `show` command provides 0 tokens. | `base` |
| Default expression token | Fallback expression name when a `show` command provides 0 tokens. | `neutral` |
| Global pose tokens | Comma-separated tokens recognized as poses during 1-token disambiguation. | `base,burst,lean,sit,stand` |

#### Character config JSON

Each key is a character name. Keys starting with `_` are silently ignored and can be used as inline comments. Unknown fields are also ignored, so legacy metadata does not need to be removed.

```json
{
  "_magical_academy": "Reference: 2000px",
  "chinami": {
    "defaultOutfit": "pajamas",
    "poseTokens": ["base", "burst", "lean"],
    "referenceHeight": 2000
  }
}
```

Supported fields per character:

| Field | Description |
|-------|-------------|
| `defaultOutfit` | Outfit used when `show` omits `in <outfit>` and no previous outfit is remembered. |
| `poseTokens` | Tokens recognized as poses during 1-token disambiguation. Overrides the global list. |
| `referenceHeight` | Baseline canvas height for this character's sprite pack. |

---

## State Inheritance

The player replays all earlier chat messages (oldest first) to build the initial stage state before processing the currently selected message. This means backgrounds, camera transforms, sprite outfits, and hidden/visible sprite state all carry forward across messages automatically.

Camera shake and sprite animations (`bounce`, `pulse`, `shake`) are one-shot: they play for a single frame and are cleared when building inherited state so they do not bleed into later messages.

Specifically:
- A background set in message 3 is still active in message 7 unless a later `scene` command changes it.
- `scene <bg>` without a segment reuses the segment from the previous `scene` command, even if that command is in an earlier message.
- `hide` removes the visible sprite but the remembered outfit is kept. A later `show` will restore the same outfit.
- A `camera at closeup` persists until a bare `camera` command clears it.

---

## Supported Animations

| Animation | Where | Effect |
|-----------|-------|--------|
| `shake` | `camera at shake` or `show ... at shake` | Brief horizontal shake |
| `bounce` | `show ... at bounce` | Short vertical bounce |
| `pulse` | `show ... at pulse` | Brief scale-up pulse |

Multiple animations can be combined with positions in a single `at` clause, e.g. `at left, bounce`. All `at` clause tokens are comma-separated.

---

## Limitations

This is a simplified Ren'Py-like renderer, not a full Ren'Py engine. The following are **not** supported:

- Branching, menus, labels, or jumps
- Variables or conditional logic
- Audio playback
- ATL (Animation and Transformation Language)
- Save / load
- Screen language

Only the commands documented above are recognized. Unrecognized lines are silently skipped.

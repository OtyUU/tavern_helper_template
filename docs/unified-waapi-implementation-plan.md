# Unified WAAPI Implementation Plan

## Goal

Eliminate Firefox animation desync by replacing the mixed CSS-Transition / WAAPI engine with a single WAAPI-only animation system, and merging the split-axis sprite transforms into one element.

## Current State Summary

| Element | Transform Responsibility | Engine | File |
|---|---|---|---|
| `.renpy-player__camera-layer` (×2) | Zoom + Pan X/Y | WAAPI | `player-composables.ts` L626-689 |
| `.renpy-player__sprite-shell` | Sprite X position | CSS Transition | `renpy-player.scss` L97 |
| `.renpy-player__sprite` | Sprite Y offset + Scale | CSS Transition | `renpy-player.scss` L107-111 |

**Problems solved by this plan:**
1. WAAPI ↔ CSS Transition engine mismatch (fractional-frame drift)
2. Split-axis anti-pattern (X on shell, Y+scale on sprite)
3. Permanent `will-change: transform` on sprites (excess GPU layers)

---

## Phase 1: Merge Split-Axis Transforms

Move Y offset and normalize-scale from `.renpy-player__sprite` onto `.renpy-player__sprite-shell`, so each sprite has exactly **one** animated transform element.

### Task 1.1 — Update `getSpriteShellStyle`

**File:** `useRenpyPlayerController.ts` (L1014-1017)

Current:
```ts
function getSpriteShellStyle(position: SpritePosition) {
  const xPx = getSpriteAnchorXPx(position);
  return { transform: `translate3d(${xPx}px, 0, 0) translateX(-50%)` };
}
```

Change to accept Y offset and normalize scale:
```ts
function getSpriteShellStyle(
  position: SpritePosition,
  spriteYPx: string,
  normalizeScale: number,
) {
  const xPx = getSpriteAnchorXPx(position);
  return {
    transform: `translate3d(${xPx}px, 0, 0) translateX(-50%) translateY(${spriteYPx}) scale(${normalizeScale})`,
  };
}
```

### Task 1.2 — Update `renderedSprites` computed

**File:** `useRenpyPlayerController.ts` (L941-958)

Pass the global `--sprite-y` value and per-sprite normalize scale into `getSpriteShellStyle`. The `spriteYPx` value is already computed at L759-762 as `--renpy-sprite-offset-y`. Extract it to a computed:

```ts
const spriteBaselineYPx = computed(() =>
  `${Math.round(settings.value.spriteBaselineOffsetPx * settings.value.stageHeight / 480)}px`,
);
```

Update `renderedSprites`:
```ts
shellStyle: {
  ...getSpriteShellStyle(
    sprite.position,
    spriteBaselineYPx.value,
    normalizationScale,
  ),
  '--sprite-ref-height': `${referenceHeight}px`,
},
```

Remove `'--sprite-normalize-scale'` from shell style (no longer needed as CSS variable).

### Task 1.3 — Remove transform from `.renpy-player__sprite` in SCSS

**File:** `renpy-player.scss` (L102-112)

Before:
```scss
.renpy-player__sprite {
  display: block;
  height: 100%;
  --sprite-scale: 1;
  transform:
    translateY(var(--sprite-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale)));
  transform-origin: center center;
  transition: transform var(--renpy-camera-transition-ms) ease;
  will-change: transform;
}
```

After:
```scss
.renpy-player__sprite {
  display: block;
  height: 100%;
}
```

### Task 1.4 — Simplify CSS keyframe animations

The keyframes currently duplicate the full base transform in every frame. With Y/scale on the parent shell, keyframes become trivial relative offsets.

**File:** `renpy-player.scss`

**`renpy-shake`** (L138-160) → simplify to X-only offsets:
```scss
@keyframes renpy-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-6px); }
  40%      { transform: translateX(6px); }
  60%      { transform: translateX(-4px); }
  80%      { transform: translateX(4px); }
}
```

**`renpy-bounce`** (L219-237) → simplify to Y-only offsets:
```scss
@keyframes renpy-bounce {
  0%, 100% { transform: translateY(0); }
  30%      { transform: translateY(-20px); }
  55%      { transform: translateY(0); }
  75%      { transform: translateY(-8px); }
}
```

**`renpy-pulse`** (L243-253) → simplify to scale-only:
```scss
@keyframes renpy-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
```

### Task 1.5 — Remove dead `spriteStyle` computed

**File:** `useRenpyPlayerController.ts` (L886-890)

`spriteStyle` currently only sets `--sprite-scale: 1`. After Phase 1, nothing reads it. Remove the computed and its usage in `SceneLayer.vue` (L53).

### Task 1.6 — Clean up `--sprite-y` / `--sprite-scale` from `stageStyle`

**File:** `useRenpyPlayerController.ts` (L759-762)

Remove the `--sprite-y` and `--renpy-sprite-offset-y` variables from `stageStyle` since they're now baked into `getSpriteShellStyle` via `spriteBaselineYPx`.

---

## Phase 2: Replace CSS Transitions with WAAPI on Sprite Shells

### Task 2.1 — Remove CSS transitions from sprite shell

**File:** `renpy-player.scss` (L88-100)

Before:
```scss
.renpy-player__sprite-shell {
  /* ... layout rules ... */
  transition: transform var(--renpy-camera-transition-ms) ease;
}
```

After — remove only the `transition` line. Keep all layout rules.

### Task 2.2 — Track previous sprite shell transforms

**File:** `player-composables.ts`, inside `useScenePresentation`

Add a `Map<string, string>` to track previous transform values per sprite ID:

```ts
const prevSpriteShellTransforms = new Map<string, string>();
```

Update on every `displayedSprites` change (after frame apply, in syncOnly path and after WAAPI finishes).

### Task 2.3 — Refactor `trackSpritePositionTransitions` to use WAAPI

**File:** `player-composables.ts` (L775-808)

Replace the `trackCssTransition` call with WAAPI:

```ts
function trackSpritePositionTransitions(spriteShells: HTMLElement[]): void {
  if (effectsDisabled.value || prefersReducedMotion.value) return;
  if (cameraTransitionMs.value <= 0) return;

  const currentSprites = displayedSprites.value ?? [];
  const previousSprites = previousDisplayedSprites.value ?? [];

  const spritesToTrack = currentSprites.filter(current => {
    const previous = previousSprites.find(p => p.id === current.id);
    return previous && previous.position !== current.position;
  });

  if (spritesToTrack.length === 0) {
    // Still update prev transforms for sprites that appeared or had no change
    syncPrevSpriteShellTransforms(spriteShells);
    return;
  }

  for (const sprite of spritesToTrack) {
    const shell = spriteShells.find(el => el?.dataset.spriteId === sprite.id);
    if (!shell) continue;

    const from = prevSpriteShellTransforms.get(sprite.id) ?? shell.style.transform;
    const to = shell.style.transform || 'none';

    if (from === to) continue;

    // Reuse the existing animateCameraLayerWAAPI for sprite shells
    let waapiCleanup: (() => void) | null = null;
    const cancel = () => { waapiCleanup?.(); };
    const deregister = bus.register(cancel);

    waapiCleanup = animateCameraLayerWAAPI(
      shell, from, to, cameraTransitionMs.value,
      () => { deregister(); },
    );
  }

  syncPrevSpriteShellTransforms(spriteShells);
}

function syncPrevSpriteShellTransforms(spriteShells: HTMLElement[]): void {
  prevSpriteShellTransforms.clear();
  for (const shell of spriteShells) {
    const id = shell?.dataset.spriteId;
    if (id) {
      prevSpriteShellTransforms.set(id, shell.style.transform || 'none');
    }
  }
}
```

### Task 2.4 — Synchronize WAAPI `startTime` across all animations

**File:** `player-composables.ts`, inside `animateCameraLayerWAAPI` (L626-689)

Add an optional `startTime` parameter:

```ts
function animateCameraLayerWAAPI(
  element: HTMLElement,
  fromTransform: string,
  toTransform: string,
  durationMs: number,
  onDone?: () => void,
  explicitStartTime?: number | null,  // NEW
): () => void {
  // ... existing early returns ...

  const animation = element.animate(
    [{ transform: fromTransform }, { transform: toTransform }],
    { duration: durationMs, easing: 'ease', fill: 'none' },
  );

  // Pin to shared timeline origin
  if (explicitStartTime != null) {
    animation.startTime = explicitStartTime;
  }

  // ... rest unchanged ...
}
```

Capture the shared start time once per frame transition in `trackCameraTransformTransition`:

```ts
const sharedStartTime = document.timeline.currentTime as number;
// Pass to all animateCameraLayerWAAPI calls for camera + sprites
```

Expose `sharedStartTime` via a ref so `trackSpritePositionTransitions` (called from a different watcher) can read it:

```ts
const currentFrameStartTime = ref<number | null>(null);
```

Set it in `trackCameraTransformTransition`'s `nextTick`, clear it after a microtask.

### Task 2.5 — Remove `trackCssTransition` function

**File:** `player-composables.ts` (L691-764)

After Phase 2.3, `trackCssTransition` has no callers. Delete the entire function.

---

## Phase 3: `will-change` Cleanup

### Task 3.1 — Add animating class for sprite shells

**File:** `renpy-player.scss`

Add:
```scss
.renpy-player__sprite-shell--animating {
  will-change: transform;
}
```

### Task 3.2 — Toggle animating class on WAAPI start/finish

**File:** `player-composables.ts`

In the sprite WAAPI animation dispatch (Task 2.3), add the class before animation starts, remove it in `onDone`:
```ts
shell.classList.add('renpy-player__sprite-shell--animating');
// ... in onDone callback:
shell.classList.remove('renpy-player__sprite-shell--animating');
```

This matches the existing camera layer pattern (`renpy-player__camera-layer--animating`).

---

## Phase 4: Cleanup & Context Update

### Task 4.1 — Remove `--renpy-camera-transition-ms` from CSS

**File:** `renpy-player.scss`

After Phases 1-3, no CSS rule reads `--renpy-camera-transition-ms` for transitions. The variable can remain in `stageStyle` for diagnostics but has no styling effect.

### Task 4.2 — Update `context.md`

**File:** `context.md` (L61-62, L105-106, L109, L129)

Update the bus registration list:
```diff
-- ✅ Camera transform CSS transitions (registered in `useScenePresentation.trackCameraTransformTransition`)
+- ✅ Camera transform WAAPI animations (registered in `useScenePresentation.trackCameraTransformTransition`)
-- ✅ Sprite position CSS transitions (registered in `useScenePresentation.trackSpritePositionTransitions`)
+- ✅ Sprite position WAAPI animations (registered in `useScenePresentation.trackSpritePositionTransitions`)
```

Update the "Two-Layer Camera Architecture" section to note that sprite shells now carry the full transform (X + Y + scale), animated via WAAPI in sync with camera layers.

### Task 4.3 — Verify `SceneLayer.vue` watcher still works

**File:** `SceneLayer.vue` (L84-92)

The existing `flush: 'post'` watcher that calls `trackSpritePositionTransitions` should continue to work unchanged — it fires after DOM update, which is when the new inline transforms are already set by Vue. No changes needed to this file (beyond removing `:style="controller.scene.spriteStyle"` from Task 1.5).

---

## Files Changed (Summary)

| File | Changes |
|---|---|
| `renpy-player.scss` | Remove sprite transitions, `will-change`, simplify keyframes, add shell animating class |
| `player-composables.ts` | WAAPI sprite animations, `startTime` sync, remove `trackCssTransition`, track prev shell transforms |
| `useRenpyPlayerController.ts` | Merge shell style (X+Y+scale), extract `spriteBaselineYPx`, remove `spriteStyle`, cleanup CSS vars |
| `SceneLayer.vue` | Remove `:style="controller.scene.spriteStyle"` binding |
| `context.md` | Update bus registration docs and camera architecture notes |

## Execution Order

Phases 1 → 2 → 3 → 4 (sequential, each phase is independently testable).

**Phase 1** is the riskiest (visual change to all sprite positioning + keyframes). Test by verifying sprites render at identical positions as before, and shake/bounce/pulse animations still look correct.

**Phase 2** is the core desync fix. Test by comparing Firefox camera+sprite transitions before/after — the jitter at start/end of transitions should be eliminated.

**Phase 3** is a minor GPU optimization. Verify via Firefox DevTools "Layers" panel that sprite layers are only promoted during active animations.

## Risk Mitigation

- **Regression check:** Sprite visual positions must match pixel-for-pixel before/after Phase 1. The transform math is equivalent: `parent(translateX) * child(translateY, scale)` = `parent(translateX, translateY, scale)`.
- **Keyframe animations:** After simplification, these run on a child element whose parent now has the base transform. CSS `transform` on the child is additive to the parent's — so relative offsets (shake ±6px, bounce -20px) produce the same visual result.
- **`fill: 'none'`:** All sprite WAAPI animations must use `fill: 'none'` so Vue retains ownership of `style.transform`. When the animation finishes, the element displays Vue's inline value (the target state). This is the same pattern used for camera animations.
- **Normalize scale changes:** `normalizeScale` locks on first `SmartImage` resolution and doesn't change afterward (documented in context.md L120). No WAAPI needed for scale transitions.

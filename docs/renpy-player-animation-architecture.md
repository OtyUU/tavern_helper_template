# Ren'Py Player Animation Architecture & Desync Analysis

## Overview

This document provides a detailed breakdown of the current animation and transform architecture within the `renpy-player` component. It specifically addresses the root causes of the synchronization issues, micro-stutters, and "jitter" observed in Firefox during simultaneous camera and sprite transitions.

## 1. The Nested Transform Architecture (3-Layer Hierarchy)

The current rendering architecture relies heavily on nested CSS `transform` properties to position, scale, and move elements on the stage. The visual representation is broken down into three independent layers that are animated simultaneously:

1.  **Camera Layer (`.renpy-player__camera-layer`)**
    *   **Responsibility:** Handles global Zoom and Pan (both X and Y).
    *   **Implementation:** Animated via the Web Animations API (WAAPI) using `element.animate()` inside the `useScenePresentation` composable.
2.  **Sprite Shell (`.renpy-player__sprite-shell`)**
    *   **Responsibility:** Handles horizontal positioning of individual sprites on the stage (X coordinate).
    *   **Implementation:** Animated via CSS Transitions (`transition: transform`). Transforms are dynamically applied inline.
3.  **Sprite Image (`.renpy-player__sprite`)**
    *   **Responsibility:** Handles vertical positioning (Y offset) and individual scaling.
    *   **Implementation:** Animated via CSS Transitions (`transition: transform`).

### Why this is problematic for Firefox:
When a browser renders a frame, it must calculate the final pixel position of the deepest child by multiplying the transformation matrices of all its parents: `Final Transform = Camera Matrix * Shell Matrix * Sprite Matrix`.
Because all three elements are animating *at the same time*, the browser must interpolate all three matrices independently frame-by-frame and then multiply them. Firefox's compositor (Gecko) struggles with compound sub-pixel interpolation across nested animating matrices, causing visible jitter and rounding artifacts, especially at the start and end of the transition curves where the delta is smallest.

## 2. Animation Engine Conflict: WAAPI vs. CSS Transitions

The architecture mixes two fundamentally different animation engines to achieve a synchronized effect:
*   **Camera Animations:** Driven by JavaScript using WAAPI (`element.animate({ transform: ... }, { easing: 'ease' })`).
*   **Sprite Animations:** Driven by the CSS Engine (`transition: transform var(...) ease`).

### Why this is problematic for Firefox:
Even if both animations are triggered in the same tick with the exact same duration and easing function (`ease`), Firefox processes them differently. 
*   **Timeline Desynchronization:** WAAPI and CSS transitions may not attach to the exact same rendering timeline in Firefox.
*   **Microtask / `nextTick` Race Condition:** In the code, CSS transitions on sprites start *implicitly* the moment Vue patches the DOM `style` attribute. However, the WAAPI animation for the camera is triggered explicitly via JavaScript *inside a `nextTick` callback* after reading the new transforms. This can result in a 1-frame (~16ms) offset between the camera starting to move and the sprites starting to move, which exactly explains the "jerk" at the beginning and end.
*   **Easing Curve Discrepancies:** The mathematical approximation of the `ease` Bezier curve in Firefox's CSS engine vs. its WAAPI engine can differ slightly.
This engine mismatch guarantees that the parent (camera) and the children (sprites) will drift slightly out of sync during the animation, resulting in the "jerky" movements at the beginning and end of the motion.

## 2.5. Split Axis Animation (X and Y on different elements)
Another critical detail is how sprite movement is implemented:
*   Horizontal movement (X) is animated via CSS transition on `.renpy-player__sprite-shell`.
*   Vertical movement (Y) and Scale are animated via CSS transition on the child `.renpy-player__sprite`.

### Why this is problematic:
If a sprite moves diagonally (changing X and Y simultaneously), the browser must interpolate the X transition on the parent and the Y transition on the child. If the compositor threads desync even by a fraction of a millisecond, the resulting diagonal path will "bow" or jitter instead of moving in a perfectly straight line. Splitting transforms across nested elements is an anti-pattern for smooth animations.

## 3. Excessive Compositor Layers (`will-change: transform`)

Currently, `will-change: transform` is applied to both the parent (`.renpy-player__camera-layer--animating`) and its children (`.renpy-player__sprite`).

### Why this is problematic for Firefox:
`will-change: transform` instructs the browser to promote the element to its own GPU compositor layer (texture). 
By applying it to both the camera and the sprites, Firefox creates a separate GPU texture for the camera, and separate GPU textures for every sprite inside it. When a parent GPU texture is scaled and translated while its child textures are also translating independently, Firefox often fails to align them perfectly to the physical pixel grid. This is a known Firefox rendering quirk (Layer Jitter). Chromium handles this scenario much better due to its different compositing thread architecture.

## 4. TransitionBus and Phase FSM Interruptions

The `TransitionBus` tracks all in-flight visual transitions. When all registered animations finish (`bus.count === 0`), it unlocks the Phase FSM, transitioning the state from `scene` to `reveal`. While the bus itself does not move pixels, it indirectly causes the "jerk" at the very end of animations.

### Why this is problematic:
1. **Asynchronous Completion:** Because WAAPI and CSS transitions are offset by a `nextTick` delay, they do not finish at the exact same millisecond. One animation will conclude slightly before the other.
2. **Main-Thread Blocking:** When the bus hits 0, the FSM instantly advances to `reveal`. This triggers `beginReveal()`, which executes heavy JavaScript text splitting (`Intl.Segmenter`), updates HUD visibility, and triggers a cascade of Vue reactive updates for the typewriter effect.
3. **The "End-Jerk":** If the faster animation (e.g., the CSS sprite transition) finishes and clears its bus lock, it might trigger this massive Vue UI update *while the slower WAAPI camera animation is still trying to paint its final frame*. This sudden main-thread block steals resources from the compositor, causing the last frame of the lagging animation to freeze or skip.

## 5. Key Files for Understanding This Issue

If you need to investigate or refactor this system, the relevant logic is distributed across these files:

*   **`src/renpy-player/SceneLayer.vue`**
    *   **What to look for:** The nested DOM structure. Notice how `<SmartImage>` (sprite) is inside `.renpy-player__sprite-shell`, which is inside `.renpy-player__camera-layer`.
*   **`src/renpy-player/renpy-player.scss`**
    *   **What to look for:** The `transition: transform` rules applied to `.renpy-player__sprite-shell` and `.renpy-player__sprite`, and the aggressive use of `will-change: transform`.
*   **`src/renpy-player/player-composables.ts`**
    *   **What to look for:** 
        *   `useScenePresentation`: Contains `trackCameraTransformTransition` (which uses WAAPI and `nextTick`) and `trackSpritePositionTransitions` (which relies on CSS transitions and `trackCssTransition`).
        *   `useDialogueReveal`: The `beginReveal()` function, which contains the heavy text splitting (`Intl.Segmenter`) logic that blocks the main thread.
*   **`src/renpy-player/useRenpyPlayerController.ts`**
    *   **What to look for:** The `applyFrame` orchestration and the Phase FSM integration that triggers the `reveal` state as soon as the `TransitionBus` clears.
*   **`src/renpy-player/useTransitionBus.ts`**
    *   **What to look for:** The core logic of how transitions register themselves and release their locks.

---

## Proposed Architectural Solutions

To resolve these conflicts, the architecture must be simplified to reduce matrix complexity and unify the animation engines.

### Option A: Transform Flattening (Recommended)
This is the most robust solution for cross-browser stability. Instead of relying on the DOM hierarchy to combine transforms, calculate the final absolute matrix in JavaScript.
1.  Keep the Camera container static (no transforms applied to `.renpy-player__camera-layer`).
2.  For every sprite, calculate its final absolute transform in JavaScript: `(Camera Pan X/Y) + (Sprite Pos X/Y) * (Camera Zoom) * (Sprite Scale)`.
3.  Apply this single computed `transform` directly to the `.renpy-player__sprite-shell`.
4.  Result: Only *one* element animates. No matrix multiplication by the browser, completely eliminating nested rounding errors.

### Option B: Unified Animation Engine & Layer Cleanup
If flattening is too complex to implement:
1.  **Stop mixing WAAPI and CSS Transitions.** Remove `transition: transform` from `.renpy-player__sprite-shell` and `.renpy-player__sprite`.
2.  Animate the sprites using the exact same WAAPI `element.animate()` call used for the camera layer inside `trackSpritePositionTransitions`. Ensure all animations are dispatched in the same microtask.
3.  **Remove `will-change: transform`** from the child sprites. Let the sprites paint onto the parent Camera's compositor layer so they move perfectly in sync when the parent scales or pans.

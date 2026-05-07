import { computed, onScopeDispose, ref, watchEffect, type Ref } from 'vue';
import type { PlayerFrame } from './types';
import type { TransitionBus } from './useTransitionBus';

/**
 * Phase of frame playback state machine.
 * - 'scene': Visual animations are settling, dialogue reveal is blocked
 * - 'reveal': Typewriter is revealing or ready to skip
 * - 'done': Everything complete, ready to advance to next frame
 */
export type FramePhase = 'scene' | 'reveal' | 'done';

/**
 * Composable interface for frame phase state management.
 */
export interface FramePhaseComposable {
  /**
   * Current phase of frame playback.
   * 
   * **Invariant:**
   * - Phase transitions always follow the sequence: scene → reveal → done
   * - Phase never skips states (except instant mode: scene → reveal directly)
   */
  readonly phase: Ref<FramePhase>;
  
  /**
   * True when scene motion is in progress (phase === 'scene').
   * Gates transport buttons and stage click advance.
   * 
   * **Invariant:**
   * - isBusy === (phase === 'scene') at all times
   */
  readonly isBusy: Ref<boolean>;
  
  /**
   * Apply the next frame with proper phase coordination.
   * Cancels in-flight work, sets phase to 'scene', increments frameIndex.
   * 
   * **Preconditions:**
   * - frameIndex.value is within valid range for current direction
   * - frames.value has at least one frame
   * 
   * **Postconditions:**
   * - All in-flight transitions are cancelled via bus.cancelAll()
   * - phase.value is set to 'scene'
   * - frameIndex.value is incremented (forward) or decremented (backward)
   * - Vue's reactivity triggers currentFrame recomputation
   * 
   * @param direction - 'forward' or 'backward' for motion mode
   */
  applyNextFrame(direction: 'forward' | 'backward'): void;
  
  /**
   * Apply a specific frame index with proper phase coordination.
   * Used for restart, jump-to-frame, etc.
   * 
   * **Preconditions:**
   * - targetIndex is within valid range [0, frames.length)
   * 
   * **Postconditions:**
   * - All in-flight transitions are cancelled via bus.cancelAll()
   * - phase.value is set to 'scene'
   * - frameIndex.value is set to targetIndex
   * - Vue's reactivity triggers currentFrame recomputation
   * 
   * @param targetIndex - Frame index to jump to
   */
  applyFrameIndex(targetIndex: number): void;
}

/**
 * Create a frame phase state machine for coordinating visual animations and dialogue reveal.
 * 
 * The phase FSM manages three states:
 * 1. **scene**: Visual animations (crossfades, sprite transitions, camera effects) are in progress
 * 2. **reveal**: Dialogue typewriter reveal is in progress or ready to skip
 * 3. **done**: All animations and reveals complete, ready to advance
 * 
 * Phase transitions are automatic:
 * - scene → reveal: When bus.count reaches 0 (all animations complete) or instant mode
 * - reveal → done: When isFullyRevealed becomes true
 * 
 * **Preconditions:**
 * - bus is a valid TransitionBus instance
 * - frameIndex is a valid ref with non-negative integer
 * - frames is a valid ref with array of frames
 * - currentFrame is a valid ref (may be null)
 * - isFullyRevealed is a valid boolean ref
 * - beginReveal is a callable function
 * - effectsDisabled is a valid boolean ref
 * 
 * **Postconditions:**
 * - Returns valid FramePhaseComposable instance
 * - phase.value initialized to 'scene'
 * - isBusy.value reflects current phase
 * - Watchers are set up for automatic phase transitions
 * - Cleanup is registered with onScopeDispose
 * 
 * **Loop Invariants:**
 * - Phase transitions always follow the sequence: scene → reveal → done
 * - isBusy always equals (phase === 'scene')
 * - beginReveal() is called exactly once per frame when transitioning to 'reveal' phase
 * 
 * @param bus - TransitionBus for tracking in-flight animations
 * @param frameIndex - Current frame index ref
 * @param frames - Array of all frames
 * @param currentFrame - Current frame being displayed
 * @param isFullyRevealed - Whether dialogue reveal is complete
 * @param beginReveal - Function to start dialogue reveal
 * @param effectsDisabled - Whether instant mode is enabled (reduced motion)
 * @returns FramePhaseComposable instance
 * 
 * @example
 * ```typescript
 * const bus = useTransitionBus();
 * const { phase, isBusy, applyNextFrame } = useFramePhase(
 *   bus,
 *   frameIndex,
 *   frames,
 *   currentFrame,
 *   isFullyRevealed,
 *   beginReveal,
 *   effectsDisabled
 * );
 * 
 * // Check if scene is busy
 * if (isBusy.value) {
 *   console.log('Scene animations in progress');
 * }
 * 
 * // Advance to next frame
 * applyNextFrame('forward');
 * ```
 */
export function useFramePhase(
  bus: TransitionBus,
  frameIndex: Ref<number>,
  frames: Ref<PlayerFrame[]>,
  currentFrame: Ref<PlayerFrame | null>,
  isFullyRevealed: Ref<boolean>,
  beginReveal: () => void,
  effectsDisabled: Ref<boolean>,
  blockReveal: Ref<boolean> = ref(false),
): FramePhaseComposable {
  // ─── Core phase state ─────────────────────────────────────────────────────
  
  /**
   * Current phase of frame playback.
   * Initial value is 'scene' to ensure animations settle before reveal.
   */
  const phase = ref<FramePhase>('scene');
  
  /**
   * Computed busy state based on phase.
   * True when phase === 'scene' (visual animations in progress).
   */
  const isBusy = computed(() => phase.value === 'scene');
  
  // ─── Phase transition watchers ────────────────────────────────────────────
  
  /**
   * Watch for scene → reveal transition.
   * 
   * Triggers when:
   * - Instant mode is enabled (effectsDisabled), OR
   * - All visual animations complete (bus.count === 0)
   * 
   * Uses flush: 'post' to ensure DOM updates complete before transition.
   */
  const stopSceneWatcher = watchEffect(() => {
    // Only transition from 'scene' phase
    if (phase.value !== 'scene') {
      return;
    }
    
    console.info('[useFramePhase] Scene watcher triggered:', {
      phase: phase.value,
      busCount: bus.count.value,
      effectsDisabled: effectsDisabled.value,
      frameIndex: frameIndex.value,
    });
    
    // Instant mode: skip scene wait entirely (Req 3.1, 7.6)
    if (effectsDisabled.value) {
      console.info('[useFramePhase] Instant mode: transitioning scene → reveal');
      phase.value = 'reveal';
      beginReveal();
      return;
    }
    
    // Normal mode: wait for all animations to complete and reveal not blocked
    if (bus.count.value === 0 && !blockReveal.value) {
      console.info('[useFramePhase] Scene settled: transitioning scene → reveal');
      phase.value = 'reveal';
      beginReveal();
    }
  }, { flush: 'post' });
  
  /**
   * Watch for reveal → done transition.
   * 
   * Triggers when:
   * - Typewriter reveal completes (isFullyRevealed becomes true)
   * 
   * Uses flush: 'post' to ensure DOM updates complete before transition.
   */
  const stopRevealWatcher = watchEffect(() => {
    // Only transition from 'reveal' phase
    if (phase.value !== 'reveal') {
      return;
    }
    
    // Wait for reveal to complete
    if (isFullyRevealed.value) {
      console.info('[useFramePhase] Reveal complete: transitioning reveal → done');
      phase.value = 'done';
    }
  }, { flush: 'post' });
  
  // ─── Frame navigation methods ─────────────────────────────────────────────
  
  /**
   * Apply the next frame with proper phase coordination.
   * 
   * This method:
   * 1. Cancels all in-flight transitions via bus.cancelAll()
   * 2. Resets phase to 'scene'
   * 3. Increments or decrements frameIndex based on direction
   * 
   * The phase FSM will automatically transition through scene → reveal → done
   * as animations complete and reveal finishes.
   * 
   * @param direction - 'forward' to increment, 'backward' to decrement
   */
  function applyNextFrame(direction: 'forward' | 'backward'): void {
    console.info(`[useFramePhase] applyNextFrame(${direction}): cancelling in-flight work`);
    
    // Cancel all in-flight transitions
    bus.cancelAll();
    
    // Reset phase to 'scene' to start new cycle
    phase.value = 'scene';
    
    // Update frame index
    if (direction === 'forward') {
      frameIndex.value = Math.min(frameIndex.value + 1, frames.value.length - 1);
    } else {
      frameIndex.value = Math.max(frameIndex.value - 1, 0);
    }
    
    console.info(`[useFramePhase] Frame index now: ${frameIndex.value}, phase: ${phase.value}`);
  }
  
  /**
   * Apply a specific frame index with proper phase coordination.
   * 
   * This method:
   * 1. Cancels all in-flight transitions via bus.cancelAll()
   * 2. Resets phase to 'scene'
   * 3. Sets frameIndex to targetIndex
   * 
   * Used for restart, jump-to-frame, and other direct navigation.
   * 
   * @param targetIndex - Frame index to jump to
   */
  function applyFrameIndex(targetIndex: number): void {
    console.info(`[useFramePhase] applyFrameIndex(${targetIndex}): cancelling in-flight work`);
    
    // Cancel all in-flight transitions
    bus.cancelAll();
    
    // Reset phase to 'scene' to start new cycle
    phase.value = 'scene';
    
    // Set frame index to target
    frameIndex.value = Math.max(0, Math.min(targetIndex, frames.value.length - 1));
    
    console.info(`[useFramePhase] Frame index now: ${frameIndex.value}, phase: ${phase.value}`);
  }
  
  // ─── Cleanup ──────────────────────────────────────────────────────────────
  
  /**
   * Register cleanup on component unmount.
   * Stops all watchers and disposes of the bus.
   */
  onScopeDispose(() => {
    console.info('[useFramePhase] Disposing: stopping watchers');
    stopSceneWatcher();
    stopRevealWatcher();
  });
  
  // ─── Return composable interface ──────────────────────────────────────────
  
  return {
    phase,
    isBusy,
    applyNextFrame,
    applyFrameIndex,
  };
}

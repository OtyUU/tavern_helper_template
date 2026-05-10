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

export interface FramePhaseComposable {
  readonly phase: Ref<FramePhase>;
  readonly isBusy: Ref<boolean>;
  /** Cancels in-flight transitions and resets phase to 'scene'. */
  resetToScene(reason?: string): void;
  applyNextFrame(direction: 'forward' | 'backward'): void;
  applyFrameIndex(targetIndex: number): void;
}

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
  const phase = ref<FramePhase>('scene');
  const isBusy = computed(() => phase.value === 'scene');

  function resetToScene(reason?: string): void {
    bus.cancelAll();
    phase.value = 'scene';
  }

  const stopSceneWatcher = watchEffect(() => {
    if (phase.value !== 'scene') return;

    if (effectsDisabled.value) {
      phase.value = 'reveal';
      beginReveal();
      return;
    }

    if (bus.count.value === 0 && !blockReveal.value) {
      phase.value = 'reveal';
      beginReveal();
    }
  }, { flush: 'post' });

  const stopRevealWatcher = watchEffect(() => {
    if (phase.value !== 'reveal') return;

    if (isFullyRevealed.value) {
      phase.value = 'done';
    }
  }, { flush: 'post' });

  function applyNextFrame(direction: 'forward' | 'backward'): void {
    resetToScene(`applyNextFrame:${direction}`);

    if (direction === 'forward') {
      frameIndex.value = Math.min(frameIndex.value + 1, frames.value.length - 1);
    } else {
      frameIndex.value = Math.max(frameIndex.value - 1, 0);
    }
  }

  function applyFrameIndex(targetIndex: number): void {
    resetToScene('applyFrameIndex');
    frameIndex.value = Math.max(0, Math.min(targetIndex, frames.value.length - 1));
  }

  onScopeDispose(() => {
    stopSceneWatcher();
    stopRevealWatcher();
  });

  return {
    phase,
    isBusy,
    resetToScene,
    applyNextFrame,
    applyFrameIndex,
  };
}

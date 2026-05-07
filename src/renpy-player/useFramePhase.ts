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

  const stopSceneWatcher = watchEffect(() => {
    if (phase.value !== 'scene') return;

    console.info('[useFramePhase] Scene watcher triggered:', {
      phase: phase.value,
      busCount: bus.count.value,
      effectsDisabled: effectsDisabled.value,
      frameIndex: frameIndex.value,
    });

    if (effectsDisabled.value) {
      console.info('[useFramePhase] Instant mode: transitioning scene → reveal');
      phase.value = 'reveal';
      beginReveal();
      return;
    }

    if (bus.count.value === 0 && !blockReveal.value) {
      console.info('[useFramePhase] Scene settled: transitioning scene → reveal');
      phase.value = 'reveal';
      beginReveal();
    }
  }, { flush: 'post' });

  const stopRevealWatcher = watchEffect(() => {
    if (phase.value !== 'reveal') return;

    if (isFullyRevealed.value) {
      console.info('[useFramePhase] Reveal complete: transitioning reveal → done');
      phase.value = 'done';
    }
  }, { flush: 'post' });

  function applyNextFrame(direction: 'forward' | 'backward'): void {
    console.info(`[useFramePhase] applyNextFrame(${direction}): cancelling in-flight work`);
    bus.cancelAll();
    phase.value = 'scene';

    if (direction === 'forward') {
      frameIndex.value = Math.min(frameIndex.value + 1, frames.value.length - 1);
    } else {
      frameIndex.value = Math.max(frameIndex.value - 1, 0);
    }

    console.info(`[useFramePhase] Frame index now: ${frameIndex.value}, phase: ${phase.value}`);
  }

  function applyFrameIndex(targetIndex: number): void {
    console.info(`[useFramePhase] applyFrameIndex(${targetIndex}): cancelling in-flight work`);
    bus.cancelAll();
    phase.value = 'scene';
    frameIndex.value = Math.max(0, Math.min(targetIndex, frames.value.length - 1));
    console.info(`[useFramePhase] Frame index now: ${frameIndex.value}, phase: ${phase.value}`);
  }

  onScopeDispose(() => {
    console.info('[useFramePhase] Disposing: stopping watchers');
    stopSceneWatcher();
    stopRevealWatcher();
  });

  return {
    phase,
    isBusy,
    applyNextFrame,
    applyFrameIndex,
  };
}

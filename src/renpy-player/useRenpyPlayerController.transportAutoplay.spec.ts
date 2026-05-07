import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { PlayerFrame } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

/**
 * Integration tests for transport and autoplay gating (Task 14.3)
 * 
 * These tests validate Requirements 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4:
 * - Transport buttons disabled during scene phase (Req 4.1, 4.2)
 * - Transport buttons enabled after scene settles (Req 4.3)
 * - Instant mode never disables transport (Req 4.4)
 * - Autoplay waits for phase === 'done' (Req 5.1, 5.2, 5.3)
 * - Autoplay advances and restarts phase cycle (Req 5.4)
 */
describe('Transport and Autoplay Gating Integration', () => {
  let bus: ReturnType<typeof useTransitionBus>;
  let frameIndex: ReturnType<typeof ref<number>>;
  let frames: ReturnType<typeof ref<PlayerFrame[]>>;
  let currentFrame: ReturnType<typeof ref<PlayerFrame | null>>;
  let isFullyRevealed: ReturnType<typeof ref<boolean>>;
  let beginReveal: ReturnType<typeof vi.fn>;
  let effectsDisabled: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    bus = useTransitionBus();
    frameIndex = ref(0);
    frames = ref([
      { index: 0, text: 'Frame 0' } as PlayerFrame,
      { index: 1, text: 'Frame 1' } as PlayerFrame,
      { index: 2, text: 'Frame 2' } as PlayerFrame,
    ]);
    currentFrame = ref(frames.value[0]);
    isFullyRevealed = ref(false);
    beginReveal = vi.fn();
    effectsDisabled = ref(false);
  });

  describe('Transport Button Gating', () => {
    describe('Requirement 4.1, 4.2: Transport buttons disabled during scene phase', () => {
      it('should disable transport controls when phase is "scene"', () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Initial phase is 'scene'
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);

        // Transport controls should be disabled (isBusy === true)
        // In the controller, canStepForward checks !isBusy.value
        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(false);
      });

      it('should keep transport disabled while animations are in progress', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register multiple animations
        const cleanup1 = bus.register(vi.fn());
        const cleanup2 = bus.register(vi.fn());
        const cleanup3 = bus.register(vi.fn());

        await nextTick();

        // Should still be in scene phase
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);

        // Complete one animation
        cleanup1();
        await nextTick();

        // Still in scene phase (2 animations remaining)
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);

        // Complete second animation
        cleanup2();
        await nextTick();

        // Still in scene phase (1 animation remaining)
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);

        // Complete final animation
        cleanup3();
        await nextTick();

        // Now should transition to reveal
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);
      });

      it('should disable transport during scene crossfade', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Simulate scene crossfade registration
        let timeoutHandle: number | undefined;
        const cleanup = bus.register(() => {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
          }
        });

        // Schedule crossfade completion
        timeoutHandle = window.setTimeout(() => {
          cleanup();
        }, 500);

        await nextTick();

        // Transport should be disabled during crossfade
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);
      });

      it('should disable transport during sprite transitions', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Simulate sprite enter animation
        const mockAnimation = {
          cancel: vi.fn(),
          addEventListener: vi.fn(),
        };

        const cleanup = bus.register(() => {
          mockAnimation.cancel();
        });

        await nextTick();

        // Transport should be disabled during sprite animation
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);
      });
    });

    describe('Requirement 4.3: Transport buttons enabled after scene settles', () => {
      it('should enable transport controls when phase transitions to "reveal"', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Initial: scene phase, transport disabled
        expect(phase.value).toBe('scene');
        expect(isBusy.value).toBe(true);

        // Scene settles (no animations)
        await nextTick();

        // Transport should be enabled
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);

        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(true);
      });

      it('should enable transport controls when phase is "done"', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Advance to reveal phase
        await nextTick();
        expect(phase.value).toBe('reveal');

        // Complete reveal
        isFullyRevealed.value = true;
        await nextTick();

        // Transport should be enabled
        expect(phase.value).toBe('done');
        expect(isBusy.value).toBe(false);

        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(true);
      });

      it('should re-enable transport after animations complete', async () => {
        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register animations
        const cleanup1 = bus.register(vi.fn());
        const cleanup2 = bus.register(vi.fn());

        await nextTick();

        // Transport disabled during animations
        expect(isBusy.value).toBe(true);

        // Complete all animations
        cleanup1();
        cleanup2();
        await nextTick();

        // Transport should be re-enabled
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);
      });
    });

    describe('Requirement 4.4: Instant mode never disables transport', () => {
      it('should never disable transport when instant mode is enabled', async () => {
        effectsDisabled.value = true;

        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Initial phase
        expect(phase.value).toBe('scene');

        await nextTick();

        // Should immediately transition to reveal (no scene wait)
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);

        // Transport should be enabled
        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(true);
      });

      it('should ignore animation registrations in instant mode', async () => {
        effectsDisabled.value = true;

        const { phase, isBusy } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register animations (should be ignored)
        bus.register(vi.fn());
        bus.register(vi.fn());
        bus.register(vi.fn());

        await nextTick();

        // Should still transition to reveal immediately
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);

        // Transport should be enabled
        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(true);
      });

      it('should maintain transport enabled throughout instant mode playback', async () => {
        effectsDisabled.value = true;

        const { phase, isBusy, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Initial frame
        await nextTick();
        expect(isBusy.value).toBe(false);

        // Advance to next frame
        isFullyRevealed.value = false;
        beginReveal.mockClear();
        applyNextFrame('forward');

        // Should immediately be ready (no scene wait)
        await nextTick();
        expect(phase.value).toBe('reveal');
        expect(isBusy.value).toBe(false);

        // Transport should remain enabled
        const canStepForward = !isBusy.value;
        expect(canStepForward).toBe(true);
      });
    });
  });

  describe('Autoplay Gating', () => {
    describe('Requirement 5.1, 5.2: Autoplay waits during scene and reveal phases', () => {
      it('should not allow autoplay advance during scene phase', async () => {
        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register animations to keep in scene phase
        bus.register(vi.fn());

        await nextTick();

        // Should be in scene phase
        expect(phase.value).toBe('scene');

        // canAutoAdvanceNow should be false (phase !== 'done')
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(false);
      });

      it('should not allow autoplay advance during reveal phase', async () => {
        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Advance to reveal phase
        await nextTick();

        expect(phase.value).toBe('reveal');
        expect(isFullyRevealed.value).toBe(false);

        // canAutoAdvanceNow should be false (phase !== 'done')
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(false);
      });

      it('should wait for all animations before allowing autoplay', async () => {
        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register multiple animations
        const cleanup1 = bus.register(vi.fn());
        const cleanup2 = bus.register(vi.fn());
        const cleanup3 = bus.register(vi.fn());

        await nextTick();

        // Should be in scene phase
        expect(phase.value).toBe('scene');

        // Complete animations one by one
        cleanup1();
        await nextTick();
        expect(phase.value).toBe('scene'); // Still waiting

        cleanup2();
        await nextTick();
        expect(phase.value).toBe('scene'); // Still waiting

        cleanup3();
        await nextTick();
        expect(phase.value).toBe('reveal'); // Now advanced

        // Still not ready for autoplay (reveal in progress)
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(false);
      });
    });

    describe('Requirement 5.3: Autoplay advances when phase === "done"', () => {
      it('should allow autoplay advance when phase is "done"', async () => {
        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Advance to reveal phase
        await nextTick();
        expect(phase.value).toBe('reveal');

        // Complete reveal
        isFullyRevealed.value = true;
        await nextTick();

        expect(phase.value).toBe('done');

        // canAutoAdvanceNow should be true
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(true);
      });

      it('should only allow autoplay when everything is complete', async () => {
        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Complete full cycle: scene → reveal → done
        await nextTick(); // scene → reveal
        expect(phase.value).toBe('reveal');

        isFullyRevealed.value = true;
        await nextTick(); // reveal → done
        expect(phase.value).toBe('done');

        // Now autoplay should be allowed
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(true);
      });

      it('should not allow autoplay if no next frame exists', async () => {
        // Set to last frame
        frameIndex.value = 2;
        currentFrame.value = frames.value[2];

        const { phase } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Complete full cycle
        await nextTick();
        isFullyRevealed.value = true;
        await nextTick();

        expect(phase.value).toBe('done');

        // canAutoAdvanceNow should be false (no next frame)
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        const canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;

        expect(canAutoAdvanceNow).toBe(false);
      });
    });

    describe('Requirement 5.4: Autoplay advances and restarts phase cycle', () => {
      it('should restart phase cycle after autoplay advance', async () => {
        const { phase, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Complete first frame cycle
        await nextTick(); // scene → reveal
        isFullyRevealed.value = true;
        await nextTick(); // reveal → done

        expect(phase.value).toBe('done');
        expect(frameIndex.value).toBe(0);

        // Simulate autoplay advance
        isFullyRevealed.value = false;
        beginReveal.mockClear();
        applyNextFrame('forward');

        // Phase should reset to 'scene'
        expect(phase.value).toBe('scene');
        expect(frameIndex.value).toBe(1);

        // Cycle should restart: scene → reveal → done
        await nextTick();
        expect(phase.value).toBe('reveal');
        expect(beginReveal).toHaveBeenCalledTimes(1);

        isFullyRevealed.value = true;
        await nextTick();
        expect(phase.value).toBe('done');
      });

      it('should maintain phase cycle across multiple autoplay advances', async () => {
        const { phase, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        const phaseHistory: string[] = [];

        // Frame 0: scene → reveal → done
        phaseHistory.push(phase.value); // 'scene'
        await nextTick();
        phaseHistory.push(phase.value); // 'reveal'
        isFullyRevealed.value = true;
        await nextTick();
        phaseHistory.push(phase.value); // 'done'

        // Advance to frame 1
        isFullyRevealed.value = false;
        beginReveal.mockClear();
        applyNextFrame('forward');
        phaseHistory.push(phase.value); // 'scene'

        // Frame 1: scene → reveal → done
        await nextTick();
        phaseHistory.push(phase.value); // 'reveal'
        isFullyRevealed.value = true;
        await nextTick();
        phaseHistory.push(phase.value); // 'done'

        // Advance to frame 2
        isFullyRevealed.value = false;
        beginReveal.mockClear();
        applyNextFrame('forward');
        phaseHistory.push(phase.value); // 'scene'

        // Frame 2: scene → reveal → done
        await nextTick();
        phaseHistory.push(phase.value); // 'reveal'
        isFullyRevealed.value = true;
        await nextTick();
        phaseHistory.push(phase.value); // 'done'

        // Verify complete phase sequence
        expect(phaseHistory).toEqual([
          'scene', 'reveal', 'done', // Frame 0
          'scene', 'reveal', 'done', // Frame 1
          'scene', 'reveal', 'done', // Frame 2
        ]);
      });

      it('should reset phase to scene on every frame advance', async () => {
        const { phase, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Complete first frame
        await nextTick();
        isFullyRevealed.value = true;
        await nextTick();
        expect(phase.value).toBe('done');

        // Advance frame
        isFullyRevealed.value = false;
        applyNextFrame('forward');

        // Phase should immediately reset to 'scene'
        expect(phase.value).toBe('scene');
      });
    });

    describe('Integration: Complete autoplay cycle', () => {
      it('should simulate complete autoplay behavior with phase gating', async () => {
        const { phase, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        const autoplayLog: string[] = [];

        // Helper to check if autoplay can advance
        const checkCanAutoAdvance = () => {
          const hasFrames = frames.value.length > 0;
          const hasNextStep = frameIndex.value < frames.value.length - 1;
          const isGenerationInProgress = false;
          return hasFrames &&
            phase.value === 'done' &&
            hasNextStep &&
            !isGenerationInProgress;
        };

        // Frame 0: Initial state
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Scene settles
        await nextTick();
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Reveal completes
        isFullyRevealed.value = true;
        await nextTick();
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Autoplay can now advance
        expect(checkCanAutoAdvance()).toBe(true);

        // Simulate autoplay advance
        isFullyRevealed.value = false;
        beginReveal.mockClear();
        applyNextFrame('forward');
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Frame 1: Scene settles
        await nextTick();
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Reveal completes
        isFullyRevealed.value = true;
        await nextTick();
        autoplayLog.push(`Frame ${frameIndex.value}: phase=${phase.value}, canAdvance=${checkCanAutoAdvance()}`);

        // Autoplay can advance again
        expect(checkCanAutoAdvance()).toBe(true);

        // Verify log shows correct gating behavior
        expect(autoplayLog).toEqual([
          'Frame 0: phase=scene, canAdvance=false',   // Scene phase: autoplay waits
          'Frame 0: phase=reveal, canAdvance=false',  // Reveal phase: autoplay waits
          'Frame 0: phase=done, canAdvance=true',     // Done phase: autoplay can advance
          'Frame 1: phase=scene, canAdvance=false',   // Scene phase: autoplay waits
          'Frame 1: phase=reveal, canAdvance=false',  // Reveal phase: autoplay waits
          'Frame 1: phase=done, canAdvance=true',     // Done phase: autoplay can advance
        ]);
      });

      it('should handle autoplay with animations', async () => {
        const { phase, applyNextFrame } = useFramePhase(
          bus,
          frameIndex,
          frames,
          currentFrame,
          isFullyRevealed,
          beginReveal,
          effectsDisabled,
        );

        // Register animation
        const cleanup = bus.register(vi.fn());

        await nextTick();

        // Autoplay should wait during scene phase
        expect(phase.value).toBe('scene');
        const hasFrames = frames.value.length > 0;
        const hasNextStep = frameIndex.value < frames.value.length - 1;
        const isGenerationInProgress = false;
        let canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;
        expect(canAutoAdvanceNow).toBe(false);

        // Complete animation
        cleanup();
        await nextTick();

        // Autoplay should still wait during reveal phase
        expect(phase.value).toBe('reveal');
        canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;
        expect(canAutoAdvanceNow).toBe(false);

        // Complete reveal
        isFullyRevealed.value = true;
        await nextTick();

        // Now autoplay can advance
        expect(phase.value).toBe('done');
        canAutoAdvanceNow = 
          hasFrames &&
          phase.value === 'done' &&
          hasNextStep &&
          !isGenerationInProgress;
        expect(canAutoAdvanceNow).toBe(true);
      });
    });
  });

  describe('Combined Transport and Autoplay Scenarios', () => {
    it('should coordinate transport and autoplay gating correctly', async () => {
      const { phase, isBusy, applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Initial: transport disabled, autoplay cannot advance
      expect(isBusy.value).toBe(true);
      expect(phase.value).toBe('scene');

      // Scene settles: transport enabled, autoplay still cannot advance
      await nextTick();
      expect(isBusy.value).toBe(false);
      expect(phase.value).toBe('reveal');

      // Reveal completes: transport enabled, autoplay can advance
      isFullyRevealed.value = true;
      await nextTick();
      expect(isBusy.value).toBe(false);
      expect(phase.value).toBe('done');

      // Advance frame: transport disabled again, autoplay cannot advance
      isFullyRevealed.value = false;
      beginReveal.mockClear();
      applyNextFrame('forward');
      expect(isBusy.value).toBe(true);
      expect(phase.value).toBe('scene');

      // Cycle repeats
      await nextTick();
      expect(isBusy.value).toBe(false);
      expect(phase.value).toBe('reveal');
    });

    it('should maintain instant mode behavior for both transport and autoplay', async () => {
      effectsDisabled.value = true;

      const { phase, isBusy, applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Instant mode: transport never disabled
      await nextTick();
      expect(phase.value).toBe('reveal');
      expect(isBusy.value).toBe(false);

      // Complete reveal
      isFullyRevealed.value = true;
      await nextTick();
      expect(phase.value).toBe('done');

      // Advance frame
      isFullyRevealed.value = false;
      beginReveal.mockClear();
      applyNextFrame('forward');

      // Transport still enabled immediately
      await nextTick();
      expect(phase.value).toBe('reveal');
      expect(isBusy.value).toBe(false);
    });
  });
});

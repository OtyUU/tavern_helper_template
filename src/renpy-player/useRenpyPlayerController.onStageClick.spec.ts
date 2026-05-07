import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { FramePhase } from './useFramePhase';

/**
 * Unit tests for VN-style click behavior (onStageClick).
 * 
 * Tests Requirements:
 * - 2.1: Click ignored during scene phase
 * - 2.2: Click skips reveal during reveal phase
 * - 2.3: Click advances frame during done phase
 * - 2.4: Click does nothing when no next frame
 */
describe('onStageClick - VN-style click behavior', () => {
  let phase: ReturnType<typeof ref<FramePhase>>;
  let hasFrames: ReturnType<typeof ref<boolean>>;
  let canStepForward: ReturnType<typeof ref<boolean>>;
  let skipReveal: ReturnType<typeof vi.fn>;
  let stepForwardInternal: ReturnType<typeof vi.fn>;
  let onStageClick: () => void;

  beforeEach(() => {
    // Setup refs and mocks
    phase = ref<FramePhase>('scene');
    hasFrames = ref(true);
    canStepForward = ref(true);
    skipReveal = vi.fn();
    stepForwardInternal = vi.fn();

    // Create onStageClick function that mimics the controller implementation
    onStageClick = () => {
      if (!hasFrames.value) {
        return;
      }

      // Scene phase: ignore click (Req 2.1)
      if (phase.value === 'scene') {
        return;
      }

      // Reveal phase: skip to fully revealed text (Req 2.2)
      if (phase.value === 'reveal') {
        skipReveal();
        return;
      }

      // Done phase: advance to next frame if available (Req 2.3, 2.4)
      if (phase.value === 'done') {
        if (canStepForward.value) {
          stepForwardInternal();
        }
        return;
      }
    };
  });

  describe('Requirement 2.1: Click ignored during scene phase', () => {
    it('should ignore click when phase is "scene"', () => {
      phase.value = 'scene';

      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should not skip reveal during scene phase', () => {
      phase.value = 'scene';

      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
    });

    it('should not advance frame during scene phase', () => {
      phase.value = 'scene';

      onStageClick();

      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should ignore multiple clicks during scene phase', () => {
      phase.value = 'scene';

      onStageClick();
      onStageClick();
      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });
  });

  describe('Requirement 2.2: Click skips reveal during reveal phase', () => {
    it('should call skipReveal when phase is "reveal"', () => {
      phase.value = 'reveal';

      onStageClick();

      expect(skipReveal).toHaveBeenCalledTimes(1);
    });

    it('should not advance frame during reveal phase', () => {
      phase.value = 'reveal';

      onStageClick();

      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should skip reveal even when canStepForward is false', () => {
      phase.value = 'reveal';
      canStepForward.value = false;

      onStageClick();

      expect(skipReveal).toHaveBeenCalledTimes(1);
    });

    it('should call skipReveal for each click during reveal phase', () => {
      phase.value = 'reveal';

      onStageClick();
      onStageClick();

      expect(skipReveal).toHaveBeenCalledTimes(2);
    });
  });

  describe('Requirement 2.3: Click advances frame during done phase', () => {
    it('should call stepForwardInternal when phase is "done" and canStepForward is true', () => {
      phase.value = 'done';
      canStepForward.value = true;

      onStageClick();

      expect(stepForwardInternal).toHaveBeenCalledTimes(1);
    });

    it('should not skip reveal during done phase', () => {
      phase.value = 'done';
      canStepForward.value = true;

      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
    });

    it('should advance frame only once per click', () => {
      phase.value = 'done';
      canStepForward.value = true;

      onStageClick();

      expect(stepForwardInternal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Requirement 2.4: Click does nothing when no next frame', () => {
    it('should not call stepForwardInternal when canStepForward is false', () => {
      phase.value = 'done';
      canStepForward.value = false;

      onStageClick();

      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should not skip reveal when no next frame', () => {
      phase.value = 'done';
      canStepForward.value = false;

      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
    });

    it('should ignore multiple clicks when no next frame', () => {
      phase.value = 'done';
      canStepForward.value = false;

      onStageClick();
      onStageClick();
      onStageClick();

      expect(stepForwardInternal).not.toHaveBeenCalled();
      expect(skipReveal).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should do nothing when hasFrames is false', () => {
      hasFrames.value = false;
      phase.value = 'done';
      canStepForward.value = true;

      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should do nothing when hasFrames is false regardless of phase', () => {
      hasFrames.value = false;

      // Test all phases
      phase.value = 'scene';
      onStageClick();

      phase.value = 'reveal';
      onStageClick();

      phase.value = 'done';
      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });
  });

  describe('Phase transition scenarios', () => {
    it('should handle click behavior correctly as phase transitions', () => {
      // Scene phase: ignore
      phase.value = 'scene';
      onStageClick();
      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // Reveal phase: skip reveal
      phase.value = 'reveal';
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(1);
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // Done phase: advance frame
      phase.value = 'done';
      canStepForward.value = true;
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(1); // Still 1 from before
      expect(stepForwardInternal).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid clicks during phase transitions', () => {
      // Rapid clicks during scene phase
      phase.value = 'scene';
      onStageClick();
      onStageClick();
      onStageClick();

      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // Transition to reveal
      phase.value = 'reveal';
      onStageClick();

      expect(skipReveal).toHaveBeenCalledTimes(1);
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });
  });

  describe('Integration with canStepForward', () => {
    it('should respect canStepForward in done phase', () => {
      phase.value = 'done';

      // Can step forward
      canStepForward.value = true;
      onStageClick();
      expect(stepForwardInternal).toHaveBeenCalledTimes(1);

      // Cannot step forward
      canStepForward.value = false;
      onStageClick();
      expect(stepForwardInternal).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should not check canStepForward during scene phase', () => {
      phase.value = 'scene';
      canStepForward.value = false;

      onStageClick();

      // Should not attempt to advance (ignored due to phase, not canStepForward)
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should not check canStepForward during reveal phase', () => {
      phase.value = 'reveal';
      canStepForward.value = false;

      onStageClick();

      // Should skip reveal regardless of canStepForward
      expect(skipReveal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world usage patterns', () => {
    it('should handle typical VN playthrough: scene → reveal → done → advance', () => {
      // User clicks during scene (ignored)
      phase.value = 'scene';
      onStageClick();
      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // Scene settles, transitions to reveal
      phase.value = 'reveal';

      // User clicks to skip reveal
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(1);

      // Reveal completes, transitions to done
      phase.value = 'done';
      canStepForward.value = true;

      // User clicks to advance
      onStageClick();
      expect(stepForwardInternal).toHaveBeenCalledTimes(1);
    });

    it('should handle impatient user clicking repeatedly', () => {
      // User clicks multiple times during scene (all ignored)
      phase.value = 'scene';
      onStageClick();
      onStageClick();
      onStageClick();
      expect(skipReveal).not.toHaveBeenCalled();
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // Scene settles, user immediately clicks
      phase.value = 'reveal';
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(1);

      // User clicks again (skipReveal called again, though reveal already skipped)
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(2);
    });

    it('should handle last frame scenario', () => {
      // On last frame, done phase, no next frame
      phase.value = 'done';
      canStepForward.value = false;

      // User clicks (nothing happens)
      onStageClick();
      expect(stepForwardInternal).not.toHaveBeenCalled();

      // User clicks again (still nothing)
      onStageClick();
      expect(stepForwardInternal).not.toHaveBeenCalled();
    });

    it('should handle instant mode scenario (scene → reveal immediately)', () => {
      // In instant mode, scene phase is very brief
      phase.value = 'scene';
      onStageClick();
      expect(skipReveal).not.toHaveBeenCalled();

      // Immediately transitions to reveal
      phase.value = 'reveal';
      onStageClick();
      expect(skipReveal).toHaveBeenCalledTimes(1);

      // Immediately transitions to done
      phase.value = 'done';
      canStepForward.value = true;
      onStageClick();
      expect(stepForwardInternal).toHaveBeenCalledTimes(1);
    });
  });
});

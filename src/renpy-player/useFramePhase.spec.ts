import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { PlayerFrame } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

describe('useFramePhase', () => {
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

  describe('initialization', () => {
    it('should initialize with phase "scene"', () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(phase.value).toBe('scene');
    });

    it('should initialize with isBusy true', () => {
      const { isBusy } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(isBusy.value).toBe(true);
    });

    it('should return all required methods', () => {
      const result = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(result).toHaveProperty('phase');
      expect(result).toHaveProperty('isBusy');
      expect(result).toHaveProperty('applyNextFrame');
      expect(result).toHaveProperty('applyFrameIndex');
      expect(typeof result.applyNextFrame).toBe('function');
      expect(typeof result.applyFrameIndex).toBe('function');
    });
  });

  describe('phase transitions - normal mode', () => {
    it('should transition from scene to reveal when bus.count reaches 0', async () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(phase.value).toBe('scene');

      // Simulate animation completion
      await nextTick();
      
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });

    it('should wait for bus.count to reach 0 before transitioning to reveal', async () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register some animations
      const cleanup1 = bus.register(vi.fn());
      const cleanup2 = bus.register(vi.fn());

      await nextTick();

      // Should still be in scene phase
      expect(phase.value).toBe('scene');
      expect(beginReveal).not.toHaveBeenCalled();

      // Complete one animation
      cleanup1();
      await nextTick();

      // Still in scene phase (one animation remaining)
      expect(phase.value).toBe('scene');
      expect(beginReveal).not.toHaveBeenCalled();

      // Complete second animation
      cleanup2();
      await nextTick();

      // Now should transition to reveal
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });

    it('should transition from reveal to done when isFullyRevealed becomes true', async () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Wait for scene → reveal transition
      await nextTick();
      expect(phase.value).toBe('reveal');

      // Simulate reveal completion
      isFullyRevealed.value = true;
      await nextTick();

      expect(phase.value).toBe('done');
    });

    it('should follow complete phase sequence: scene → reveal → done', async () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      const phaseHistory: string[] = [];
      
      // Track phase changes
      phaseHistory.push(phase.value);

      // scene → reveal
      await nextTick();
      phaseHistory.push(phase.value);

      // reveal → done
      isFullyRevealed.value = true;
      await nextTick();
      phaseHistory.push(phase.value);

      expect(phaseHistory).toEqual(['scene', 'reveal', 'done']);
    });

    it('should call beginReveal exactly once per frame', async () => {
      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      await nextTick();
      expect(beginReveal).toHaveBeenCalledTimes(1);

      // Trigger watcher again (shouldn't call beginReveal again)
      isFullyRevealed.value = true;
      await nextTick();

      expect(beginReveal).toHaveBeenCalledTimes(1);
    });
  });

  describe('phase transitions - instant mode', () => {
    it('should skip scene wait when effectsDisabled is true', async () => {
      effectsDisabled.value = true;

      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(phase.value).toBe('scene');

      await nextTick();

      // Should immediately transition to reveal
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });

    it('should not wait for bus.count in instant mode', async () => {
      effectsDisabled.value = true;

      const { phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register animations (should be ignored in instant mode)
      bus.register(vi.fn());
      bus.register(vi.fn());

      await nextTick();

      // Should still transition to reveal immediately
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBusy computed', () => {
    it('should be true when phase is "scene"', () => {
      const { phase, isBusy } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(phase.value).toBe('scene');
      expect(isBusy.value).toBe(true);
    });

    it('should be false when phase is "reveal"', async () => {
      const { phase, isBusy } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      await nextTick();

      expect(phase.value).toBe('reveal');
      expect(isBusy.value).toBe(false);
    });

    it('should be false when phase is "done"', async () => {
      const { phase, isBusy } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      await nextTick();
      isFullyRevealed.value = true;
      await nextTick();

      expect(phase.value).toBe('done');
      expect(isBusy.value).toBe(false);
    });

    it('should maintain isBusy === (phase === "scene") invariant', async () => {
      const { phase, isBusy } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // scene
      expect(isBusy.value).toBe(phase.value === 'scene');

      // reveal
      await nextTick();
      expect(isBusy.value).toBe(phase.value === 'scene');

      // done
      isFullyRevealed.value = true;
      await nextTick();
      expect(isBusy.value).toBe(phase.value === 'scene');
    });
  });

  describe('applyNextFrame', () => {
    it('should cancel all in-flight transitions', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);

      applyNextFrame('forward');

      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
    });

    it('should reset phase to "scene"', async () => {
      const { phase, applyNextFrame } = useFramePhase(
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

      // Apply next frame
      applyNextFrame('forward');

      expect(phase.value).toBe('scene');
    });

    it('should increment frameIndex when direction is "forward"', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      expect(frameIndex.value).toBe(0);

      applyNextFrame('forward');

      expect(frameIndex.value).toBe(1);
    });

    it('should decrement frameIndex when direction is "backward"', () => {
      frameIndex.value = 2;

      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      applyNextFrame('backward');

      expect(frameIndex.value).toBe(1);
    });

    it('should clamp frameIndex to valid range', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Try to go backward from 0
      applyNextFrame('backward');
      expect(frameIndex.value).toBe(0);

      // Go to last frame
      frameIndex.value = 2;

      // Try to go forward from last frame
      applyNextFrame('forward');
      expect(frameIndex.value).toBe(2);
    });
  });

  describe('applyFrameIndex', () => {
    it('should cancel all in-flight transitions', () => {
      const { applyFrameIndex } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);

      applyFrameIndex(1);

      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
    });

    it('should reset phase to "scene"', async () => {
      const { phase, applyFrameIndex } = useFramePhase(
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

      // Apply specific frame
      applyFrameIndex(1);

      expect(phase.value).toBe('scene');
    });

    it('should set frameIndex to target', () => {
      const { applyFrameIndex } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      applyFrameIndex(2);

      expect(frameIndex.value).toBe(2);
    });

    it('should clamp targetIndex to valid range', () => {
      const { applyFrameIndex } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Try negative index
      applyFrameIndex(-5);
      expect(frameIndex.value).toBe(0);

      // Try index beyond array
      applyFrameIndex(999);
      expect(frameIndex.value).toBe(2);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle complete frame playback cycle', async () => {
      const { phase, applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Initial: scene phase
      expect(phase.value).toBe('scene');

      // Scene settles
      await nextTick();
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);

      // Reveal completes
      isFullyRevealed.value = true;
      await nextTick();
      expect(phase.value).toBe('done');

      // User advances frame
      isFullyRevealed.value = false; // Reset for next frame
      beginReveal.mockClear();
      applyNextFrame('forward');

      // Cycle restarts
      expect(phase.value).toBe('scene');
      await nextTick();
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });

    it('should handle frame navigation during animations', async () => {
      const { phase, applyNextFrame } = useFramePhase(
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

      expect(phase.value).toBe('scene');
      expect(bus.count.value).toBe(2);

      // User navigates before animations complete
      applyNextFrame('forward');

      // Animations should be cancelled
      expect(bus.count.value).toBe(0);
      expect(phase.value).toBe('scene');
    });

    it('should handle instant mode frame advance', async () => {
      effectsDisabled.value = true;

      const { phase, applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Should immediately go to reveal
      await nextTick();
      expect(phase.value).toBe('reveal');

      // Advance frame
      isFullyRevealed.value = false;
      beginReveal.mockClear();
      applyNextFrame('forward');

      // Should immediately go to reveal again
      await nextTick();
      expect(phase.value).toBe('reveal');
      expect(beginReveal).toHaveBeenCalledTimes(1);
    });
  });
});

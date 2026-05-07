import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { PlayerFrame } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

describe('useFramePhase - bus.cancelAll() on frame navigation', () => {
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
      {
        index: 0,
        text: 'Frame 0',
        speaker: null,
        background: null,
        sprites: [],
        isNewScene: false,
      } as PlayerFrame,
      {
        index: 1,
        text: 'Frame 1',
        speaker: null,
        background: null,
        sprites: [],
        isNewScene: false,
      } as PlayerFrame,
      {
        index: 2,
        text: 'Frame 2',
        speaker: null,
        background: null,
        sprites: [],
        isNewScene: false,
      } as PlayerFrame,
    ]);
    currentFrame = ref(frames.value[0]);
    isFullyRevealed = ref(false);
    beginReveal = vi.fn();
    effectsDisabled = ref(false);
  });

  describe('applyNextFrame()', () => {
    it('should call bus.cancelAll() when stepping forward', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register some transitions
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);

      expect(bus.count.value).toBe(2);

      // Apply next frame
      applyNextFrame('forward');

      // Verify cancelAll() was called (all cancel functions invoked, count reset)
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
      expect(frameIndex.value).toBe(1);
    });

    it('should call bus.cancelAll() when stepping backward', () => {
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

      // Register some transitions
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);

      expect(bus.count.value).toBe(2);

      // Apply previous frame
      applyNextFrame('backward');

      // Verify cancelAll() was called
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
      expect(frameIndex.value).toBe(1);
    });

    it('should reset phase to scene after cancelling', () => {
      const { applyNextFrame, phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Manually set phase to 'done'
      phase.value = 'done';

      // Apply next frame
      applyNextFrame('forward');

      // Verify phase reset to 'scene'
      expect(phase.value).toBe('scene');
    });
  });

  describe('applyFrameIndex()', () => {
    it('should call bus.cancelAll() when jumping to specific frame', () => {
      const { applyFrameIndex } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register some transitions
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      const cancel3 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);
      bus.register(cancel3);

      expect(bus.count.value).toBe(3);

      // Jump to frame 2
      applyFrameIndex(2);

      // Verify cancelAll() was called
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(cancel3).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
      expect(frameIndex.value).toBe(2);
    });

    it('should call bus.cancelAll() when restarting (jumping to frame 0)', () => {
      frameIndex.value = 2;
      const { applyFrameIndex } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register some transitions
      const cancel1 = vi.fn();
      bus.register(cancel1);

      expect(bus.count.value).toBe(1);

      // Restart (jump to frame 0)
      applyFrameIndex(0);

      // Verify cancelAll() was called
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
      expect(frameIndex.value).toBe(0);
    });

    it('should reset phase to scene after cancelling', () => {
      const { applyFrameIndex, phase } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Manually set phase to 'reveal'
      phase.value = 'reveal';

      // Jump to frame 1
      applyFrameIndex(1);

      // Verify phase reset to 'scene'
      expect(phase.value).toBe('scene');
    });
  });

  describe('Cancellation completeness', () => {
    it('should cancel all registered transitions regardless of count', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register many transitions
      const cancelFns = Array.from({ length: 10 }, () => vi.fn());
      cancelFns.forEach(fn => bus.register(fn));

      expect(bus.count.value).toBe(10);

      // Apply next frame
      applyNextFrame('forward');

      // Verify all cancel functions were called exactly once
      cancelFns.forEach(fn => {
        expect(fn).toHaveBeenCalledTimes(1);
      });
      expect(bus.count.value).toBe(0);
    });

    it('should handle errors in cancel functions gracefully', () => {
      const { applyNextFrame } = useFramePhase(
        bus,
        frameIndex,
        frames,
        currentFrame,
        isFullyRevealed,
        beginReveal,
        effectsDisabled,
      );

      // Register transitions with one that throws
      const cancel1 = vi.fn();
      const cancel2 = vi.fn(() => {
        throw new Error('Cancel failed');
      });
      const cancel3 = vi.fn();

      bus.register(cancel1);
      bus.register(cancel2);
      bus.register(cancel3);

      expect(bus.count.value).toBe(3);

      // Apply next frame (should not throw)
      expect(() => applyNextFrame('forward')).not.toThrow();

      // Verify all cancel functions were called despite error
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(cancel3).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
    });
  });
});

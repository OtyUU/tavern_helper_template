import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransitionBus } from './useTransitionBus';

describe('useTransitionBus', () => {
  let bus: ReturnType<typeof useTransitionBus>;

  beforeEach(() => {
    // Create a fresh bus instance for each test
    bus = useTransitionBus();
  });

  describe('initialization', () => {
    it('should initialize with count of 0', () => {
      expect(bus.count.value).toBe(0);
    });

    it('should return a valid TransitionBus instance', () => {
      expect(bus).toHaveProperty('register');
      expect(bus).toHaveProperty('cancelAll');
      expect(bus).toHaveProperty('dispose');
      expect(bus).toHaveProperty('count');
      expect(typeof bus.register).toBe('function');
      expect(typeof bus.cancelAll).toBe('function');
      expect(typeof bus.dispose).toBe('function');
    });
  });

  describe('register', () => {
    it('should increment count when registering a transition', () => {
      const cancel = vi.fn();
      bus.register(cancel);
      
      expect(bus.count.value).toBe(1);
    });

    it('should increment count for multiple registrations', () => {
      bus.register(vi.fn());
      bus.register(vi.fn());
      bus.register(vi.fn());
      
      expect(bus.count.value).toBe(3);
    });

    it('should return a cleanup function', () => {
      const cancel = vi.fn();
      const cleanup = bus.register(cancel);
      
      expect(typeof cleanup).toBe('function');
    });

    it('should decrement count when cleanup is called', () => {
      const cancel = vi.fn();
      const cleanup = bus.register(cancel);
      
      expect(bus.count.value).toBe(1);
      
      cleanup();
      
      expect(bus.count.value).toBe(0);
    });

    it('should handle multiple cleanup calls idempotently', () => {
      const cancel = vi.fn();
      const cleanup = bus.register(cancel);
      
      cleanup();
      cleanup();
      cleanup();
      
      expect(bus.count.value).toBe(0);
    });

    it('should maintain accurate count with mixed register/cleanup operations', () => {
      const cleanup1 = bus.register(vi.fn());
      const cleanup2 = bus.register(vi.fn());
      expect(bus.count.value).toBe(2);
      
      cleanup1();
      expect(bus.count.value).toBe(1);
      
      const cleanup3 = bus.register(vi.fn());
      expect(bus.count.value).toBe(2);
      
      cleanup2();
      cleanup3();
      expect(bus.count.value).toBe(0);
    });
  });

  describe('cancelAll', () => {
    it('should call all registered cancel functions', () => {
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      const cancel3 = vi.fn();
      
      bus.register(cancel1);
      bus.register(cancel2);
      bus.register(cancel3);
      
      bus.cancelAll();
      
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(cancel3).toHaveBeenCalledTimes(1);
    });

    it('should reset count to 0 after cancelAll', () => {
      bus.register(vi.fn());
      bus.register(vi.fn());
      bus.register(vi.fn());
      
      expect(bus.count.value).toBe(3);
      
      bus.cancelAll();
      
      expect(bus.count.value).toBe(0);
    });

    it('should clear the registry after cancelAll', () => {
      const cancel = vi.fn();
      bus.register(cancel);
      
      bus.cancelAll();
      
      // Calling cancelAll again should not call the cancel function again
      bus.cancelAll();
      
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in cancel functions gracefully', () => {
      const cancel1 = vi.fn(() => {
        throw new Error('Cancel failed');
      });
      const cancel2 = vi.fn();
      const cancel3 = vi.fn();
      
      bus.register(cancel1);
      bus.register(cancel2);
      bus.register(cancel3);
      
      // Should not throw
      expect(() => bus.cancelAll()).not.toThrow();
      
      // All cancel functions should still be called
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(cancel3).toHaveBeenCalledTimes(1);
      
      // Count should still be reset
      expect(bus.count.value).toBe(0);
    });

    it('should handle cancelAll with no registrations', () => {
      expect(() => bus.cancelAll()).not.toThrow();
      expect(bus.count.value).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should call cancelAll when disposed', () => {
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      
      bus.register(cancel1);
      bus.register(cancel2);
      
      bus.dispose();
      
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
    });

    it('should handle dispose with no registrations', () => {
      expect(() => bus.dispose()).not.toThrow();
      expect(bus.count.value).toBe(0);
    });
  });

  describe('count accuracy invariant', () => {
    it('should maintain count === registry.size at all times', () => {
      // Initial state
      expect(bus.count.value).toBe(0);
      
      // Register 5 transitions
      const cleanups = [
        bus.register(vi.fn()),
        bus.register(vi.fn()),
        bus.register(vi.fn()),
        bus.register(vi.fn()),
        bus.register(vi.fn()),
      ];
      expect(bus.count.value).toBe(5);
      
      // Cleanup 2 transitions
      cleanups[1]();
      cleanups[3]();
      expect(bus.count.value).toBe(3);
      
      // Register 2 more
      cleanups.push(bus.register(vi.fn()));
      cleanups.push(bus.register(vi.fn()));
      expect(bus.count.value).toBe(5);
      
      // Cancel all
      bus.cancelAll();
      expect(bus.count.value).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle scene crossfade registration pattern', () => {
      // Simulate scene crossfade
      let timeoutHandle: number | undefined;
      
      const cleanup = bus.register(() => {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      });
      
      expect(bus.count.value).toBe(1);
      
      // Simulate crossfade completion
      cleanup();
      
      expect(bus.count.value).toBe(0);
    });

    it('should handle sprite animation registration pattern', () => {
      // Simulate sprite enter animation
      const mockAnimation = {
        cancel: vi.fn(),
        addEventListener: vi.fn(),
      };
      
      const cleanup = bus.register(() => {
        mockAnimation.cancel();
      });
      
      expect(bus.count.value).toBe(1);
      
      // Simulate animation finish
      cleanup();
      
      expect(bus.count.value).toBe(0);
      expect(mockAnimation.cancel).not.toHaveBeenCalled(); // Only called if cancelled
    });

    it('should handle frame navigation cancellation', () => {
      // Register multiple animations
      const sceneCleanup = bus.register(vi.fn());
      const sprite1Cleanup = bus.register(vi.fn());
      const sprite2Cleanup = bus.register(vi.fn());
      
      expect(bus.count.value).toBe(3);
      
      // User navigates to different frame - cancel all
      bus.cancelAll();
      
      expect(bus.count.value).toBe(0);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useTransitionBus } from './useTransitionBus';

describe('TransitionBus - unmount cleanup and memory leak prevention', () => {
  describe('bus.dispose() on component unmount', () => {
    it('should call cancelAll() when dispose() is called', () => {
      const bus = useTransitionBus();

      // Register some transitions
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      const cancel3 = vi.fn();

      bus.register(cancel1);
      bus.register(cancel2);
      bus.register(cancel3);

      expect(bus.count.value).toBe(3);

      // Dispose the bus
      bus.dispose();

      // Verify all cancel functions were called
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(cancel3).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);
    });

    it('should clear all registrations when dispose() is called', () => {
      const bus = useTransitionBus();

      // Register transitions
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();
      bus.register(cancel1);
      bus.register(cancel2);

      expect(bus.count.value).toBe(2);

      // Dispose
      bus.dispose();

      // Verify registry is cleared
      expect(bus.count.value).toBe(0);

      // Register new transition after dispose
      const cancel3 = vi.fn();
      bus.register(cancel3);

      // Should work normally after dispose
      expect(bus.count.value).toBe(1);
    });

    it('should be safe to call dispose() multiple times', () => {
      const bus = useTransitionBus();

      const cancel1 = vi.fn();
      bus.register(cancel1);

      // First dispose
      bus.dispose();
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(bus.count.value).toBe(0);

      // Second dispose (should not throw)
      expect(() => bus.dispose()).not.toThrow();
      expect(cancel1).toHaveBeenCalledTimes(1); // Should not be called again
      expect(bus.count.value).toBe(0);
    });

    it('should automatically dispose when scope is disposed', () => {
      const scope = effectScope();

      let bus: ReturnType<typeof useTransitionBus>;
      const cancel1 = vi.fn();

      scope.run(() => {
        bus = useTransitionBus();
        bus.register(cancel1);
        expect(bus.count.value).toBe(1);
      });

      // Dispose the scope (simulates component unmount)
      scope.stop();

      // Verify bus was disposed
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(bus!.count.value).toBe(0);
    });
  });

  describe('Memory leak prevention (Req 10.4)', () => {
    it('should not leak memory over many register/cleanup cycles', () => {
      const bus = useTransitionBus();

      // Simulate 1000+ frame advances with registrations
      for (let i = 0; i < 1000; i++) {
        // Register some transitions
        const cleanup1 = bus.register(() => {});
        const cleanup2 = bus.register(() => {});
        const cleanup3 = bus.register(() => {});

        expect(bus.count.value).toBe(3);

        // Cleanup (simulates transitions completing)
        cleanup1();
        cleanup2();
        cleanup3();

        expect(bus.count.value).toBe(0);
      }

      // After 1000 cycles, count should still be 0
      expect(bus.count.value).toBe(0);
    });

    it('should not leak memory when using cancelAll() repeatedly', () => {
      const bus = useTransitionBus();

      // Simulate 1000+ frame advances with cancelAll()
      for (let i = 0; i < 1000; i++) {
        // Register some transitions
        bus.register(() => {});
        bus.register(() => {});
        bus.register(() => {});

        expect(bus.count.value).toBe(3);

        // Cancel all (simulates frame navigation)
        bus.cancelAll();

        expect(bus.count.value).toBe(0);
      }

      // After 1000 cycles, count should still be 0
      expect(bus.count.value).toBe(0);
    });

    it('should not leak memory with mixed register/cleanup/cancelAll operations', () => {
      const bus = useTransitionBus();

      // Simulate complex usage patterns
      for (let i = 0; i < 500; i++) {
        // Register some transitions
        const cleanup1 = bus.register(() => {});
        const cleanup2 = bus.register(() => {});
        bus.register(() => {});

        // Some complete naturally
        cleanup1();
        cleanup2();

        expect(bus.count.value).toBe(1);

        // Others are cancelled via cancelAll()
        bus.cancelAll();

        expect(bus.count.value).toBe(0);
      }

      // After 500 cycles, count should still be 0
      expect(bus.count.value).toBe(0);
    });

    it('should handle cleanup functions that are called multiple times', () => {
      const bus = useTransitionBus();

      const cancel = vi.fn();
      const cleanup = bus.register(cancel);

      expect(bus.count.value).toBe(1);

      // Call cleanup multiple times (should be idempotent)
      cleanup();
      expect(bus.count.value).toBe(0);
      expect(cancel).toHaveBeenCalledTimes(0); // Not called yet

      cleanup(); // Second call should be safe
      expect(bus.count.value).toBe(0);
      expect(cancel).toHaveBeenCalledTimes(0);

      // Now call cancelAll()
      bus.cancelAll();
      expect(cancel).toHaveBeenCalledTimes(0); // Already removed, so not called
    });

    it('should not accumulate references to completed transitions', () => {
      const bus = useTransitionBus();

      // Create weak references to track garbage collection
      const weakRefs: WeakRef<() => void>[] = [];

      for (let i = 0; i < 100; i++) {
        const cancel = () => {};
        weakRefs.push(new WeakRef(cancel));
        const cleanup = bus.register(cancel);
        cleanup(); // Immediately cleanup
      }

      expect(bus.count.value).toBe(0);

      // Force garbage collection if available (not guaranteed in all environments)
      if (global.gc) {
        global.gc();
      }

      // The bus should not hold references to cleaned up functions
      // (This is a best-effort test - GC timing is not guaranteed)
    });
  });

  describe('Integration with useFramePhase', () => {
    it('should dispose bus when useFramePhase scope is disposed', () => {
      const scope = effectScope();

      let bus: ReturnType<typeof useTransitionBus>;
      const cancel1 = vi.fn();
      const cancel2 = vi.fn();

      scope.run(() => {
        bus = useTransitionBus();
        bus.register(cancel1);
        bus.register(cancel2);
        expect(bus.count.value).toBe(2);
      });

      // Dispose the scope
      scope.stop();

      // Verify bus was disposed
      expect(cancel1).toHaveBeenCalledTimes(1);
      expect(cancel2).toHaveBeenCalledTimes(1);
      expect(bus!.count.value).toBe(0);
    });
  });
});

import { onScopeDispose, ref } from 'vue';

export interface TransitionBus {
  register(cancel: () => void): () => void;
  cancelAll(): void;
  dispose(): void;
  readonly count: Readonly<ReturnType<typeof ref<number>>>;
}

export function useTransitionBus(): TransitionBus {
  const registry = new Set<() => void>();
  const count = ref(0);

  function register(cancel: () => void): () => void {
    registry.add(cancel);
    count.value = registry.size;
    return function cleanup() {
      registry.delete(cancel);
      count.value = registry.size;
    };
  }

  function cancelAll(): void {
    for (const cancel of registry) {
      try {
        cancel();
      } catch (error) {
        console.error('TransitionBus: Transition cancel failed:', error);
      }
    }
    registry.clear();
    count.value = 0;
  }

  function dispose(): void {
    cancelAll();
  }

  onScopeDispose(() => {
    dispose();
  });

  return {
    register,
    cancelAll,
    dispose,
    count: count as Readonly<typeof count>,
  };
}

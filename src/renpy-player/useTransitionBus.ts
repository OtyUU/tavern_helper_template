import { onScopeDispose, ref } from 'vue';

/**
 * TransitionBus interface for tracking in-flight visual transitions.
 * Provides a lightweight registry for coordinating scene animations.
 */
export interface TransitionBus {
  /**
   * Register a cancellation function for in-flight motion.
   * Returns a cleanup function that removes the registration.
   * 
   * **Preconditions:**
   * - `cancel` must be a callable function
   * - Registry is initialized
   * 
   * **Postconditions:**
   * - `cancel` function is added to registry
   * - `count` is incremented
   * - Cleanup function is returned
   * - Calling cleanup removes `cancel` from registry and decrements `count`
   * 
   * @param cancel - Function to call when cancelling this transition
   * @returns Cleanup function to unregister
   */
  register(cancel: () => void): () => void;
  
  /**
   * Cancel all registered transitions immediately.
   * Clears the registry after calling all cancel functions.
   * 
   * **Preconditions:**
   * - Registry is initialized
   * 
   * **Postconditions:**
   * - All cancel functions in registry are called
   * - Registry is cleared
   * - `count` is reset to 0
   * - Errors in cancel functions are caught and logged
   */
  cancelAll(): void;
  
  /**
   * Dispose of the bus and clean up all registrations.
   * Should be called on component unmount.
   * 
   * **Preconditions:**
   * - Bus is initialized
   * 
   * **Postconditions:**
   * - `cancelAll()` is called
   * - All registrations are cleared
   */
  dispose(): void;
  
  /**
   * Reactive count of in-flight transitions.
   * 0 means scene is settled.
   * 
   * **Invariant:**
   * - `count.value` always equals `registry.size`
   */
  readonly count: Readonly<ReturnType<typeof ref<number>>>;
}

/**
 * Create a TransitionBus for tracking in-flight visual transitions.
 * 
 * The TransitionBus provides a lightweight registry that tracks ongoing animations
 * and visual effects. Components can register cancellation functions for their
 * transitions, and the bus maintains a reactive count of in-flight work.
 * 
 * **Preconditions:**
 * - Called within Vue component setup context
 * 
 * **Postconditions:**
 * - Returns valid TransitionBus instance
 * - `count.value` initialized to 0
 * - Registry is empty
 * - All methods are bound and functional
 * - Cleanup is registered with `onScopeDispose`
 * 
 * **Loop Invariants:**
 * - `count.value` always equals `registry.size`
 * - All functions in registry are callable
 * - Registry contains no duplicates (Set semantics)
 * 
 * @returns TransitionBus instance
 * 
 * @example
 * ```typescript
 * const bus = useTransitionBus();
 * 
 * // Register a transition
 * const cleanup = bus.register(() => {
 *   animation.cancel();
 * });
 * 
 * // Later, when animation completes
 * cleanup();
 * 
 * // Or cancel all transitions
 * bus.cancelAll();
 * ```
 */
export function useTransitionBus(): TransitionBus {
  // Set-based registry for O(1) add/remove operations
  const registry = new Set<() => void>();
  
  // Reactive count of in-flight transitions
  const count = ref(0);
  
  /**
   * Register a cancellation function for in-flight motion.
   * 
   * @param cancel - Function to call when cancelling this transition
   * @returns Cleanup function to unregister
   */
  function register(cancel: () => void): () => void {
    registry.add(cancel);
    count.value = registry.size;
    
    // Return cleanup function for automatic unregistration
    return function cleanup() {
      registry.delete(cancel);
      count.value = registry.size;
    };
  }
  
  /**
   * Cancel all registered transitions immediately.
   * Catches and logs errors from individual cancel functions to prevent cascade failures.
   */
  function cancelAll(): void {
    // Call all cancel functions with error handling
    for (const cancel of registry) {
      try {
        cancel();
      } catch (error) {
        console.error('TransitionBus: Transition cancel failed:', error);
      }
    }
    
    // Clear registry and reset count
    registry.clear();
    count.value = 0;
  }
  
  /**
   * Dispose of the bus and clean up all registrations.
   */
  function dispose(): void {
    cancelAll();
  }
  
  // Register cleanup on component unmount
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

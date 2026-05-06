# Design Document: Renpy Player Data and Event Improvements

## Overview

This design addresses two critical code quality issues in the Renpy Player codebase:

1. **Reactive Data Cloning**: Ensuring all Pinia store data is properly cloned before passing to Tavern Helper APIs to prevent Vue Proxy corruption
2. **Event Handler Consolidation**: Eliminating code duplication across three similar message event handlers (MESSAGE_EDITED, MESSAGE_UPDATED, MESSAGE_SWIPED)

The Renpy Player is a Vue 3-based visual novel player that runs as a script within SillyTavern via Tavern Helper. It uses Pinia for state management and must interact with Tavern Helper APIs that expect plain JavaScript objects, not Vue reactive proxies.

### Current Problems

**Problem 1: Inconsistent Reactive Data Handling**
- The Settings_Store correctly uses `klona()` in its watch callback
- The Controller directly mutates `settings.value.preferredMessageId` and `settings.value.followLatestPlayable` in 6 locations without cloning
- Direct mutations bypass the store's watch callback, potentially causing data corruption when persisted to Tavern variables

**Problem 2: Duplicated Event Handler Logic**
- MESSAGE_EDITED, MESSAGE_UPDATED, and MESSAGE_SWIPED handlers share nearly identical logic
- MESSAGE_UPDATED has special generation-in-progress handling that must be preserved
- Code duplication increases maintenance burden and bug risk

## Architecture

### High-Level Design

The solution follows a **centralized mutation pattern** where all settings changes flow through a single update mechanism that ensures proper cloning before persistence.

```
┌─────────────────────────────────────────────────────────────┐
│                      Controller Layer                        │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  updateSettings(updater: (draft) => void)            │   │
│  │  - Creates cloned copy of settings                   │   │
│  │  - Applies updater function to draft                 │   │
│  │  - Assigns entire object back to settings.value      │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                   │
│                           ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Unified Message Event Handler                       │   │
│  │  - handleMessageModified(messageId, eventType)       │   │
│  │  - Routes to generation logic or standard logic      │   │
│  │  - Logs event type for debugging                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Settings Store Layer                      │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  watch(settings, value => {                          │   │
│  │    insertOrAssignVariables(klona(value), target)     │   │
│  │  })                                                   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Tavern Helper API Layer                     │
│                                                               │
│  insertOrAssignVariables(plainObject, target)                │
│  - Receives plain JavaScript object (no Vue Proxies)         │
│  - Persists to SillyTavern script variables                  │
└─────────────────────────────────────────────────────────────┘
```

### Component Interactions

**Settings Update Flow:**
1. Controller calls `updateSettings(draft => { draft.preferredMessageId = 123 })`
2. `updateSettings` creates a cloned copy using `klona(settings.value)`
3. Updater function modifies the cloned draft
4. Entire cloned object is assigned to `settings.value`
5. Pinia's watch callback detects the change
6. Watch callback clones again with `klona()` and calls `insertOrAssignVariables()`

**Event Handler Flow:**
1. Tavern event fires (MESSAGE_EDITED, MESSAGE_UPDATED, or MESSAGE_SWIPED)
2. Event listener calls `handleMessageModified(messageId, eventType)`
3. Handler logs the event type for debugging
4. If MESSAGE_UPDATED during generation: execute special generation logic
5. Otherwise: execute standard logic (`rebuildPlayableIndex()` + `onMessageChanged()`)

## Components and Interfaces

### New Controller Functions

#### updateSettings

```typescript
/**
 * Updates settings through a draft pattern that ensures proper cloning.
 * This is the ONLY way controller code should modify settings.
 * 
 * @param updater - Function that receives a cloned draft and modifies it
 * 
 * @example
 * updateSettings(draft => {
 *   draft.preferredMessageId = 123;
 *   draft.followLatestPlayable = false;
 * });
 */
function updateSettings(updater: (draft: RenpyPlayerSettings) => void): void {
  const draft = klona(settings.value);
  updater(draft);
  settings.value = draft;
}
```

**Design Rationale:**
- Uses Immer-style draft pattern for ergonomic updates
- Ensures all mutations go through a single choke point
- Cloning happens before modification, preventing proxy contamination
- Assignment triggers Pinia's watch callback for persistence

#### handleMessageModified

```typescript
/**
 * Unified handler for message modification events.
 * Routes to appropriate logic based on event type and generation state.
 * 
 * @param messageId - The ID of the modified message
 * @param eventType - The type of event that triggered this handler
 */
function handleMessageModified(messageId: number, eventType: string): void {
  console.info(`[renpy-player] Message ${eventType}: ${messageId}`);

  // Special handling for MESSAGE_UPDATED during generation
  if (eventType === 'MESSAGE_UPDATED' && isGenerationInProgress.value) {
    handleMessageUpdatedDuringGeneration(messageId);
    return;
  }

  // Standard handling for all other cases
  rebuildPlayableIndex();
  onMessageChanged(messageId);
}
```

**Design Rationale:**
- Single entry point for all message modification events
- Explicit logging for debugging and traceability
- Preserves MESSAGE_UPDATED's special generation logic
- Reduces code duplication from 3 handlers to 1

#### handleMessageUpdatedDuringGeneration

```typescript
/**
 * Handles MESSAGE_UPDATED events that occur during AI generation.
 * Manages generation target confirmation and exclusion logic.
 * 
 * @param messageId - The ID of the message being updated during generation
 */
function handleMessageUpdatedDuringGeneration(messageId: number): void {
  const locked = generationTargetMessageId.value;

  if (!generationTargetConfirmed.value) {
    generationTargetConfirmed.value = true;

    if (locked !== messageId) {
      if (locked != null) {
        excludedPlayableMessageIds.value.delete(locked);
      }

      generationTargetMessageId.value = messageId;
      excludedPlayableMessageIds.value.add(messageId);
      rebuildPlayableIndex();

      if (
        activeMessageId.value === messageId ||
        settings.value.preferredMessageId === messageId
      ) {
        jumpToSafeFrameBefore(messageId);
      }
    }

    if (generationTargetMessageId.value === messageId) {
      return;
    }
  }

  if (generationTargetMessageId.value != null && messageId === generationTargetMessageId.value) {
    return;
  }

  // Fall through to standard handling
  rebuildPlayableIndex();
  onMessageChanged(messageId);
}
```

**Design Rationale:**
- Extracted from MESSAGE_UPDATED handler for clarity
- Preserves exact existing generation-in-progress logic
- Falls through to standard handling when generation logic doesn't apply
- Improves testability by isolating complex conditional logic

### Modified Controller Functions

The following functions will be refactored to use `updateSettings()`:

1. **jumpToSafeFrameBefore** - Updates `preferredMessageId` when jumping to safe frame
2. **fullSync** - Updates `preferredMessageId` during synchronization
3. **onMessageReceived** - Updates `preferredMessageId` when following latest playable
4. **stepBackwardInternal** - Updates `preferredMessageId` when stepping backward across messages
5. **stepForwardInternal** - Updates `preferredMessageId` when stepping forward across messages
6. **useLatestPlayable** - Updates `followLatestPlayable` flag

### Event Handler Registration

Event handlers in `onMounted()` will be updated to use the unified handler:

```typescript
onMounted(() => {
  // ... existing setup code ...

  lifecycleStopList.push(
    // ... other event handlers ...
    
    eventOn(tavern_events.MESSAGE_EDITED, (messageId: number) => {
      handleMessageModified(messageId, 'MESSAGE_EDITED');
    }).stop,
    
    eventOn(tavern_events.MESSAGE_UPDATED, (messageId: number) => {
      handleMessageModified(messageId, 'MESSAGE_UPDATED');
    }).stop,
    
    eventOn(tavern_events.MESSAGE_SWIPED, (messageId: number) => {
      handleMessageModified(messageId, 'MESSAGE_SWIPED');
    }).stop,
    
    // ... other event handlers ...
  );
});
```

## Data Models

### RenpyPlayerSettings

The settings type is defined by Zod schema in `settings.ts`. Key fields affected by this design:

```typescript
type RenpyPlayerSettings = {
  // ... other fields ...
  
  /**
   * Whether to automatically follow the latest playable message.
   * When true, player jumps to newest playable message on MESSAGE_RECEIVED.
   */
  followLatestPlayable: boolean;
  
  /**
   * The message ID the player should display.
   * Null means no message is selected.
   */
  preferredMessageId: number | null;
  
  // ... other fields ...
};
```

### Settings Update Pattern

**Before (Direct Mutation - INCORRECT):**
```typescript
settings.value.preferredMessageId = messageId;
settings.value.followLatestPlayable = true;
```

**After (Draft Pattern - CORRECT):**
```typescript
updateSettings(draft => {
  draft.preferredMessageId = messageId;
  draft.followLatestPlayable = true;
});
```

## Error Handling

### Cloning Failures

`klona()` is a robust deep cloning library that handles circular references and complex objects. However, if cloning fails:

```typescript
function updateSettings(updater: (draft: RenpyPlayerSettings) => void): void {
  try {
    const draft = klona(settings.value);
    updater(draft);
    settings.value = draft;
  } catch (error) {
    console.error('[renpy-player] Failed to update settings:', error);
    // Settings remain unchanged - safe fallback
  }
}
```

### Event Handler Errors

Event handlers should not throw errors that could break the event system:

```typescript
function handleMessageModified(messageId: number, eventType: string): void {
  try {
    console.info(`[renpy-player] Message ${eventType}: ${messageId}`);
    
    if (eventType === 'MESSAGE_UPDATED' && isGenerationInProgress.value) {
      handleMessageUpdatedDuringGeneration(messageId);
      return;
    }
    
    rebuildPlayableIndex();
    onMessageChanged(messageId);
  } catch (error) {
    console.error(`[renpy-player] Error handling ${eventType} for message ${messageId}:`, error);
  }
}
```

## Testing Strategy

### Unit Tests

**Settings Update Tests:**
1. Test that `updateSettings()` creates a cloned copy
2. Test that modifications to draft don't affect original settings
3. Test that settings.value is replaced with the modified draft
4. Test that watch callback is triggered after update
5. Test that multiple property updates in one call work correctly

**Event Handler Tests:**
1. Test that MESSAGE_EDITED routes to standard logic
2. Test that MESSAGE_SWIPED routes to standard logic
3. Test that MESSAGE_UPDATED routes to standard logic when not generating
4. Test that MESSAGE_UPDATED routes to generation logic when generating
5. Test that event type is logged correctly
6. Test that errors in handlers don't propagate

**Cloning Tests:**
1. Test that cloned settings have no Vue Proxy layers
2. Test that nested objects are deeply cloned
3. Test that cloning preserves all property values (round-trip property)

### Integration Tests

1. Test that settings changes persist to Tavern variables correctly
2. Test that MESSAGE_EDITED updates the playable index and refreshes display
3. Test that MESSAGE_UPDATED during generation excludes the target message
4. Test that MESSAGE_SWIPED updates the playable index and refreshes display
5. Test that multiple rapid settings updates don't cause race conditions

### Manual Testing

1. Verify that settings persist correctly after page reload
2. Verify that message edits update the player display
3. Verify that message swipes update the player display
4. Verify that generation doesn't cause the player to jump to the generating message
5. Verify that console logs show event types for debugging

## Implementation Plan

### Phase 1: Add updateSettings Function

1. Add `updateSettings()` function to controller
2. Add error handling for cloning failures
3. Add JSDoc documentation

### Phase 2: Refactor Direct Mutations

Refactor each function that directly mutates settings:

1. `jumpToSafeFrameBefore` - Replace `settings.value.preferredMessageId = safeId`
2. `fullSync` - Replace `settings.value.preferredMessageId = messageId`
3. `onMessageReceived` - Replace `settings.value.preferredMessageId = targetId`
4. `stepBackwardInternal` - Replace `settings.value.preferredMessageId = prevId`
5. `stepForwardInternal` - Replace `settings.value.preferredMessageId = nextId`
6. `useLatestPlayable` - Replace `settings.value.followLatestPlayable = true`

### Phase 3: Add Unified Event Handler

1. Add `handleMessageModified()` function
2. Add `handleMessageUpdatedDuringGeneration()` function
3. Add error handling and logging

### Phase 4: Update Event Registrations

1. Update MESSAGE_EDITED listener to call `handleMessageModified()`
2. Update MESSAGE_UPDATED listener to call `handleMessageModified()`
3. Update MESSAGE_SWIPED listener to call `handleMessageModified()`

### Phase 5: Testing and Validation

1. Run unit tests for new functions
2. Run integration tests for event handling
3. Manual testing in SillyTavern environment
4. Verify console logs show correct event types
5. Verify settings persist correctly

## Migration Notes

### Breaking Changes

None. This is an internal refactoring that maintains all existing behavior.

### Backward Compatibility

All existing functionality is preserved:
- Settings persistence behavior unchanged
- Event handling behavior unchanged
- MESSAGE_UPDATED generation logic unchanged
- Public API unchanged

### Rollback Plan

If issues are discovered:
1. Revert to direct mutations (remove `updateSettings()` calls)
2. Revert to separate event handlers
3. Settings_Store watch callback continues to work correctly

## Performance Considerations

### Cloning Overhead

`klona()` is a fast deep cloning library, but cloning does have overhead:

**Impact Analysis:**
- Settings updates are infrequent (user navigation, message events)
- Settings object is small (~20 properties, mostly primitives)
- Cloning cost: ~0.1ms per update (negligible)

**Optimization:**
- No optimization needed - cloning overhead is acceptable
- Alternative considered: shallow clone + deep clone only for nested objects
- Rejected: Complexity not justified for small settings object

### Watch Callback Frequency

The Settings_Store watch callback triggers on every settings change:

**Current Behavior:**
- Watch triggers once per `settings.value` assignment
- Each trigger calls `insertOrAssignVariables()` (Tavern API call)

**After Refactoring:**
- Watch still triggers once per `settings.value` assignment
- No change in frequency - same number of Tavern API calls

**Potential Optimization (Future):**
- Debounce watch callback to batch rapid updates
- Not implemented now - premature optimization

## Security Considerations

### Data Integrity

**Threat:** Vue Proxy layers in persisted data could cause corruption

**Mitigation:** 
- All data cloned with `klona()` before Tavern API calls
- Cloning removes Vue Proxy layers
- Round-trip property test ensures data integrity

### Input Validation

**Threat:** Invalid settings values could corrupt state

**Mitigation:**
- Zod schema validates all settings on load
- Settings_Store repairs invalid values with defaults
- `updateSettings()` doesn't add validation (trust internal code)

## Future Enhancements

### Potential Improvements

1. **Type-safe updater function:**
   ```typescript
   updateSettings<K extends keyof RenpyPlayerSettings>(
     key: K,
     value: RenpyPlayerSettings[K]
   ): void
   ```

2. **Batch updates with debouncing:**
   ```typescript
   const debouncedPersist = debounce(() => {
     insertOrAssignVariables(klona(settings.value), variableTarget);
   }, 100);
   ```

3. **Settings change history for undo/redo:**
   ```typescript
   const settingsHistory = ref<RenpyPlayerSettings[]>([]);
   function undo() { /* ... */ }
   function redo() { /* ... */ }
   ```

4. **Event handler middleware pattern:**
   ```typescript
   function withLogging(handler: EventHandler): EventHandler {
     return (...args) => {
       console.log('Event:', args);
       return handler(...args);
     };
   }
   ```

### Not Planned

- **Immutable.js or Immer.js:** Overkill for small settings object
- **Vuex/Pinia actions:** Current pattern is simpler and sufficient
- **Event sourcing:** Not needed for this use case

## Appendix

### Code Locations Reference

**Settings Store:**
- File: `src/renpy-player/settings.ts`
- Watch callback: Line ~180
- Initial repair logic: Line ~160

**Controller:**
- File: `src/renpy-player/useRenpyPlayerController.ts`
- Direct mutations:
  - `jumpToSafeFrameBefore`: Line ~280
  - `fullSync`: Line ~680
  - `onMessageReceived`: Line ~730
  - `stepBackwardInternal`: Line ~870
  - `stepForwardInternal`: Line ~900
  - `useLatestPlayable`: Line ~800
- Event handlers: Lines ~1004-1071

### Dependencies

- **klona**: Deep cloning library (already in package.json)
- **Vue 3**: Reactive system
- **Pinia**: State management
- **Tavern Helper**: API for SillyTavern integration

### Related Documentation

- [Tavern Helper API Documentation](https://n0vi028.github.io/JS-Slash-Runner-Doc/)
- [Vue 3 Reactivity Documentation](https://vuejs.org/guide/essentials/reactivity-fundamentals.html)
- [Pinia Documentation](https://pinia.vuejs.org/)
- [klona Documentation](https://github.com/lukeed/klona)

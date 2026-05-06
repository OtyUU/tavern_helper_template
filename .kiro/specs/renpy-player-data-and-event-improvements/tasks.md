# Implementation Plan: Renpy Player Data and Event Improvements

## Overview

This implementation plan refactors the Renpy Player controller to ensure proper reactive data handling and consolidate duplicated event handlers. The changes focus on `src/renpy-player/useRenpyPlayerController.ts` and involve:

1. Adding a centralized `updateSettings()` function for safe settings mutations
2. Refactoring 6 functions that directly mutate settings to use the new pattern
3. Adding unified event handler functions to eliminate code duplication
4. Updating event registrations to use the unified handlers

All changes maintain existing behavior while improving code quality and preventing Vue Proxy corruption in Tavern Helper API calls.

## Tasks

- [x] 1. Add updateSettings function with error handling
  - Add `updateSettings(updater: (draft: RenpyPlayerSettings) => void): void` function to controller
  - Implement draft pattern: clone settings with `klona()`, apply updater, assign back to `settings.value`
  - Add try-catch error handling with console.error logging
  - Add JSDoc documentation explaining this is the ONLY way to modify settings
  - _Requirements: 1.1, 1.4, 1.5, 3.1, 3.2, 3.3_

- [x] 2. Refactor functions to use updateSettings
  - [x] 2.1 Refactor jumpToSafeFrameBefore function
    - Locate direct mutation: `settings.value.preferredMessageId = safeId` (around line 280)
    - Replace with: `updateSettings(draft => { draft.preferredMessageId = safeId; })`
    - Also update `manualMessageId.value = safeId` to use same pattern
    - _Requirements: 1.4, 3.1, 3.3_

  - [x] 2.2 Refactor fullSync function
    - Locate direct mutation: `settings.value.preferredMessageId = messageId` (around line 680)
    - Replace with: `updateSettings(draft => { draft.preferredMessageId = messageId; })`
    - Also update `manualMessageId.value = messageId` to use same pattern
    - _Requirements: 1.4, 3.1, 3.3_

  - [x] 2.3 Refactor onMessageReceived function
    - Locate direct mutation: `settings.value.preferredMessageId = targetId` (around line 730)
    - Replace with: `updateSettings(draft => { draft.preferredMessageId = targetId; })`
    - Also update `manualMessageId.value = targetId` to use same pattern
    - _Requirements: 1.4, 3.1, 3.3_

  - [x] 2.4 Refactor stepBackwardInternal function
    - Locate direct mutation: `settings.value.preferredMessageId = prevId` (around line 870)
    - Replace with: `updateSettings(draft => { draft.preferredMessageId = prevId; })`
    - Also update `manualMessageId.value = prevId` to use same pattern
    - _Requirements: 1.4, 3.1, 3.3_

  - [x] 2.5 Refactor stepForwardInternal function
    - Locate direct mutation: `settings.value.preferredMessageId = nextId` (around line 900)
    - Replace with: `updateSettings(draft => { draft.preferredMessageId = nextId; })`
    - Also update `manualMessageId.value = nextId` to use same pattern
    - _Requirements: 1.4, 3.1, 3.3_

  - [x] 2.6 Refactor useLatestPlayable function
    - Locate direct mutation: `settings.value.followLatestPlayable = true` (around line 800)
    - Replace with: `updateSettings(draft => { draft.followLatestPlayable = true; })`
    - _Requirements: 1.5, 3.1, 3.3_

- [x] 3. Checkpoint - Verify settings mutations work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add unified event handler functions
  - [x] 4.1 Add handleMessageUpdatedDuringGeneration function
    - Extract MESSAGE_UPDATED generation logic into separate function
    - Function signature: `handleMessageUpdatedDuringGeneration(messageId: number): void`
    - Preserve exact existing generation-in-progress logic from MESSAGE_UPDATED handler
    - Add JSDoc documentation explaining generation target confirmation logic
    - Fall through to standard handling when generation logic doesn't apply
    - _Requirements: 2.3_

  - [x] 4.2 Add handleMessageModified function
    - Function signature: `handleMessageModified(messageId: number, eventType: string): void`
    - Add console.info logging: `[renpy-player] Message ${eventType}: ${messageId}`
    - Route MESSAGE_UPDATED during generation to `handleMessageUpdatedDuringGeneration()`
    - Route all other cases to standard logic: `rebuildPlayableIndex()` + `onMessageChanged(messageId)`
    - Add try-catch error handling with console.error logging
    - Add JSDoc documentation explaining unified handler purpose
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

- [x] 5. Update event registrations in onMounted
  - [x] 5.1 Update MESSAGE_EDITED listener
    - Locate existing listener registration (around line 1011)
    - Replace handler body with: `handleMessageModified(messageId, 'MESSAGE_EDITED')`
    - Preserve existing `lifecycleStopList.push()` pattern
    - _Requirements: 2.1, 2.6_

  - [x] 5.2 Update MESSAGE_UPDATED listener
    - Locate existing listener registration (around line 1015)
    - Replace handler body with: `handleMessageModified(messageId, 'MESSAGE_UPDATED')`
    - Preserve existing `lifecycleStopList.push()` pattern
    - _Requirements: 2.1, 2.6_

  - [x] 5.3 Update MESSAGE_SWIPED listener
    - Locate existing listener registration (around line 1064)
    - Replace handler body with: `handleMessageModified(messageId, 'MESSAGE_SWIPED')`
    - Preserve existing `lifecycleStopList.push()` pattern
    - _Requirements: 2.1, 2.6_

- [x] 6. Final checkpoint - Verify all changes work correctly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All changes are internal refactoring that maintains existing behavior
- No breaking changes to public API
- Settings_Store watch callback continues to work correctly with `klona()` cloning
- Event handler consolidation reduces code duplication from 3 handlers to 1
- Console logging added for debugging message events
- Error handling ensures failures don't break the event system

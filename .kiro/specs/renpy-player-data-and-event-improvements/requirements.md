# Requirements Document

## Introduction

This document specifies requirements for improving the Renpy Player codebase with two main enhancements: proper reactive data handling before Tavern API calls, and consolidation of duplicated event handlers. The Renpy Player is a Vue-based visual novel player script that runs within SillyTavern via Tavern Helper, using Pinia stores for state management and interacting with Tavern Helper APIs to display visual novel content in chat messages.

## Glossary

- **Renpy_Player**: The Vue-based visual novel player script that displays visual novel content in SillyTavern chat messages
- **Pinia_Store**: Vue state management store using Pinia library that manages reactive data
- **Tavern_Helper_API**: The API provided by Tavern Helper for interacting with SillyTavern (e.g., `insertOrAssignVariables`, `replaceVariables`)
- **Controller**: The `useRenpyPlayerController` composable that manages player state and event handling
- **Settings_Store**: The Pinia store defined in `settings.ts` that manages player configuration
- **Reactive_Data**: Vue reactive objects wrapped in Proxy layers that enable Vue's reactivity system
- **klona**: A deep cloning library function that removes Vue Proxy layers from reactive objects
- **Message_Event**: Tavern events related to chat message changes (MESSAGE_EDITED, MESSAGE_UPDATED, MESSAGE_SWIPED)

## Requirements

### Requirement 1: Clone Reactive Data Before Tavern API Calls

**User Story:** As a developer, I want all reactive data properly cloned before Tavern API calls, so that Vue proxy layers do not cause data corruption or performance issues when persisting to SillyTavern variables.

#### Acceptance Criteria

1. WHEN `insertOrAssignVariables()` is called with data from THE Pinia_Store, THE Renpy_Player SHALL clone the data with `klona()` before the call
2. WHEN `replaceVariables()` is called with data from THE Pinia_Store, THE Renpy_Player SHALL clone the data with `klona()` before the call
3. WHEN THE Settings_Store watch callback persists settings, THE Settings_Store SHALL use `klona()` on the settings value before calling `insertOrAssignVariables()`
4. WHEN THE Controller modifies `settings.value.preferredMessageId` directly, THE Controller SHALL clone the entire settings object with `klona()` before passing to Tavern_Helper_API functions
5. WHEN THE Controller modifies `settings.value.followLatestPlayable` directly, THE Controller SHALL clone the entire settings object with `klona()` before passing to Tavern_Helper_API functions
6. FOR ALL reactive objects from Pinia stores passed to Tavern_Helper_API functions, cloning with `klona()` then passing SHALL preserve all data properties and values (round-trip property)

### Requirement 2: Consolidate Message Event Handlers

**User Story:** As a developer, I want consolidated event handlers for similar message events, so that code duplication is reduced and maintenance is simplified.

#### Acceptance Criteria

1. WHEN MESSAGE_EDITED, MESSAGE_UPDATED, or MESSAGE_SWIPED events occur, THE Controller SHALL route them through a unified message change handler function
2. THE Controller SHALL implement a single `handleMessageModified(messageId: number, eventType: string)` function that processes all three event types
3. WHEN MESSAGE_UPDATED occurs during generation, THE unified handler SHALL preserve the special generation-in-progress logic
4. WHEN MESSAGE_EDITED or MESSAGE_SWIPED occurs, THE unified handler SHALL execute `rebuildPlayableIndex()` followed by `onMessageChanged(messageId)`
5. THE unified handler SHALL log the event type that triggered the update for debugging purposes
6. THE Controller SHALL maintain the existing event listener registrations but route them to the unified handler

### Requirement 3: Eliminate Direct Settings Mutations

**User Story:** As a developer, I want to eliminate direct mutations of `settings.value` properties in the Controller, so that all settings changes go through proper reactive patterns with cloning.

#### Acceptance Criteria

1. THE Controller SHALL NOT directly assign to `settings.value.preferredMessageId` without cloning
2. THE Controller SHALL NOT directly assign to `settings.value.followLatestPlayable` without cloning
3. WHEN THE Controller needs to update settings properties, THE Controller SHALL create a cloned copy, modify the copy, and assign the entire cloned object back
4. THE Settings_Store watch callback SHALL detect all settings changes and persist them with `klona()` to Tavern variables
5. FOR ALL settings modifications in the Controller, the Settings_Store watch callback SHALL trigger exactly once per logical change (idempotence property)

### Requirement 4: Verify Existing Correct Patterns

**User Story:** As a developer, I want to verify that existing correct reactive data handling patterns are preserved, so that working code is not broken during refactoring.

#### Acceptance Criteria

1. THE Settings_Store watch callback SHALL continue to use `klona(value)` when calling `insertOrAssignVariables()`
2. THE Settings_Store initial repair logic SHALL continue to use `klona(initialSettings.value)` when persisting repaired settings
3. WHEN the Settings_Store loads persisted settings, THE Settings_Store SHALL continue to parse and validate them with Zod schemas
4. THE Settings_Store SHALL continue to provide reactive computed properties (`assetExtensions`, `globalPoseTokens`, `characterSpriteConfig`)
5. FOR ALL existing Settings_Store functionality, the behavior SHALL remain unchanged after implementing Requirements 1-3 (metamorphic property)


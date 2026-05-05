Implementation Plan 

# Phase 0 — Instrumentation + invariants (no behavior change)

### Work
1. **Add controller diagnostics state** (exposed under `controller.diagnostics` and displayed in `DiagnosticsPanel.vue`):
   - `activeMessageId`
   - `playableMessageIds` (count + maybe first/last)
   - `prevPlayableId`, `nextPlayableId`
   - `isGenerationInProgress`
   - `generationTargetMessageId`
   - `autoplayStatus` (derived: `'off' | 'active' | 'idle-end' | 'idle-generation'`)
   - `cursorKey = "${activeMessageId}:${frameIndex}"` (helper function)

2. Add helper in controller:
   - `cursorKey(messageId: number | null, frame: number)`

### Acceptance
- No user-visible behavior changes.
- Diagnostics panel renders without throwing.

---

# Phase 1 — “Playable” definition + index (skip hidden + non-script)

> This becomes the single source of truth for navigation, autoplay, and follow-latest.

### Work
1. Implement:

```ts
function isMessagePlayable(msg: ChatMessage | undefined | null): boolean {
  if (!msg) return false;
  if (msg.is_hidden) return false;
  return parseScriptFromMessage(msg.message ?? '').commands.length > 0;
}
```

2. Add state in controller:
- `playableMessageIds = ref<number[]>([])`
- `excludedPlayableMessageIds = ref<Set<number>>(new Set())` (used for generation lock)

3. Implement rebuild (initially simplest and safest):

```ts
function rebuildPlayableIndex() {
  const last = getLastMessageId();
  if (last < 0) { playableMessageIds.value = []; return; }
  const all = getChatMessages(`0-${last}`);
  const excluded = excludedPlayableMessageIds.value;
  playableMessageIds.value = all
    .filter(m => m && !excluded.has(m.message_id) && isMessagePlayable(m))
    .map(m => m!.message_id)
    .sort((a,b) => a-b);
}
```

4. Implement `findPrevPlayableId(id)` / `findNextPlayableId(id)` using binary search on `playableMessageIds.value`.

5. Event wiring: on “history-affecting” events, call `rebuildPlayableIndex()` (later you can optimize incremental updates):
- `CHAT_CHANGED`, `MORE_MESSAGES_LOADED`, `MESSAGE_RECEIVED`, `MESSAGE_DELETED`
- `MESSAGE_EDITED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPED` (important for correctness)

### Acceptance
- Hidden messages never appear in navigation.
- Edited/swiped messages correctly enter/leave the playable index without reload.

---

# Phase 2 — Cursor refactor: `(activeMessageId, frameIndex)` becomes first-class

> This is required before cross-message playback. Do this before changing navigation.

### Work
1. Add:

- `activeMessageId = ref<number | null>(settings.value.preferredMessageId ?? null)`
- Replace `currentMessage` as a **computed**:

```ts
const currentMessage = computed(() => {
  void historyTrigger.value;
  const id = activeMessageId.value;
  if (id == null) return null;
  return getChatMessages(id)[0] ?? null;
});
```

2. Keep `manualMessageId` as UI input, but make it **sync to activeMessageId** when selection succeeds.

3. Update `fullSync()`:
- Must call `rebuildPlayableIndex()` early.
- If `followLatestPlayable`, choose latest from `playableMessageIds`.
- Else choose `settings.value.preferredMessageId` if playable; otherwise snap to nearest (policy choice).

4. **Remove the current watcher that forces `frameIndex = 0` when message changes**:

```ts
watch(() => [currentMessage.value?.message_id, currentMessage.value?.message], ...)
```

This watcher will break “jump to last frame of previous message”.

Instead: only reset frameIndex inside explicit selection/navigation functions.

### Acceptance
- Single-message playback works exactly as before.
- Message changes no longer forcibly reset frameIndex (only explicit actions do).

---

# Phase 3 — History replay consistency (hidden messages)

> Prevent “invisible messages” from affecting inherited stage state.

### Work
Update the `inheritedState` builder to skip `is_hidden` messages (at minimum):

```ts
const allMessages = getChatMessages(`0-${currentId - 1}`);
for (...) {
  const m = allMessages[i];
  if (!m?.message) continue;
  if (m.is_hidden) continue;
  history.push(m.message);
}
```

(Optional: you can also skip non-playables, but skipping hidden is the main consistency fix.)

### Acceptance
- Hidden messages cannot influence stage inheritance.

---

# Phase 4 — Seamless cross-message navigation (spec #1)

## 4A) New helpers/state

### Work
1. Add:

```ts
type PendingBridge = { targetKey: string; prevFrame: PlayerFrame };
const pendingBridge = ref<PendingBridge | null>(null);

type PendingFrameTarget = null | { kind: 'first' } | { kind: 'last' };
const pendingFrameTarget = ref<PendingFrameTarget>(null);
```

2. Compute:

- `prevPlayableId = computed(() => findPrevPlayableId(activeMessageId.value))`
- `nextPlayableId = computed(() => findNextPlayableId(activeMessageId.value))`

3. Update the `watch(currentFrame, ...)` that calls `applyFrame()`:
- Use `pendingBridge` to override the `prev` passed to `applyFrame`.

Pseudo:

```ts
watch(currentFrame, (next, prev) => {
  const bridge = pendingBridge.value;
  const nextKey = next && activeMessageId.value != null ? `${activeMessageId.value}:${next.index}` : '';
  const effectivePrev = (bridge && bridge.targetKey === nextKey) ? bridge.prevFrame : (prev ?? null);
  if (bridge && bridge.targetKey === nextKey) pendingBridge.value = null;
  applyFrame(next, effectivePrev);
}, { immediate: true });
```

## 4B) Navigation rules

### Work
1. Replace `setMotionModeForNav(targetIndex)` with **cursor-aware logic**:
- Within same message: backward => instant, forward => normal
- Across message boundary:
  - forward boundary => **normal**
  - backward boundary => **instant**

2. Implement internal step functions that do **not** automatically stop autoplay:
- `stepForwardInternal(source: 'stage'|'autoplay'|'userButton')`
- `stepBackwardInternal(...)`
- Then expose “user button” wrappers that stop autoplay (Phase 6).

3. **Step forward**:
- If `frameIndex < frames.length - 1`: normal intra-message step.
- Else if `nextPlayableId != null`:
  - `motionMode = 'normal'`
  - Set bridge:

```ts
pendingBridge.value = {
  targetKey: `${nextPlayableId}:${0}`,
  prevFrame: klona(currentFrame.value!), // snapshot last frame of A
};
```

  - Switch message: `activeMessageId.value = nextPlayableId`
  - Set `frameIndex.value = 0`
  - Do **not** call `cancelAllEffects()` (seamless)

4. **Step backward**:
- If `frameIndex > 0`: backward within message, `motionMode='instant'`, `cancelAllEffects()`.
- Else if `prevPlayableId != null`:
  - `motionMode='instant'`
  - `cancelAllEffects()`
  - Switch message: `activeMessageId.value = prevPlayableId`
  - Set `pendingFrameTarget.value = { kind: 'last' }`
  - Set `frameIndex.value = Number.MAX_SAFE_INTEGER` (so your existing `watch(frames)` clamp puts you at last frame)

5. Update message stepper +/- buttons:
- They should use `prevPlayableId/nextPlayableId` (not `±1`).
- `canSelectPreviousMessage/Next` should become `prevPlayableId != null` / `nextPlayableId != null`.

6. Typed message ID behavior (define now):
- If typed id is playable: select it.
- If not playable: snap to nearest playable (recommend: nearest previous playable; if none, nearest next; else no-op).

### Acceptance
- Forward at end of message A transitions into message B frame 0 with **motionMode normal** and normal scene/sprite transitions.
- Backward at start of message B goes to message A last frame with **motionMode instant**.
- Stepper skips hidden and non-playable messages.

---

# Phase 5 — Generation/swipe safe-frame lock (spec #2)

> Prevent parsing/visual flicker while the streaming message is incomplete.

### Work
1. Add state:
- `isGenerationInProgress = ref(false)`
- `generationTargetMessageId = ref<number | null>(null)`

2. On `GENERATION_STARTED(type)`:
- Set `isGenerationInProgress.value = true`
- Set `generationTargetMessageId.value = getLastMessageId()` (best available signal)
- Exclude it:

```ts
excludedPlayableMessageIds.value.add(generationTargetMessageId.value);
rebuildPlayableIndex();
```

- If the user is currently on that message (or followLatestPlayable would otherwise snap there):
  - Jump to safe frame = **last frame of previous playable message**
  - Use backward-cross-message logic (`motionMode='instant'`, cancel effects)
  - Do **not** stop autoplay; autoplay should enter idle-generation (Phase 6)

3. On `GENERATION_ENDED()`:
- `isGenerationInProgress.value = false`
- Remove exclusion and `rebuildPlayableIndex()`
- If the newly generated message is playable, it becomes available:
  - follow-latest logic may snap (Phase 7)
  - autoplay may resume (Phase 6)

4. While `isGenerationInProgress`:
- Ignore `MESSAGE_UPDATED` spam for `generationTargetMessageId` (avoid constant index rebuild + parsing churn). Only react on `GENERATION_ENDED`.

### Acceptance
- During streaming, the viewport stays on the safe frame and does not flicker.
- When generation ends, the new message is evaluated once and becomes playable (or not).

---

# Phase 6 — Autoplay redesign (continuous + idle + manual cancellation) (spec #3)

## 6A) Update can-advance logic to include cross-message “next step”

### Work
1. Add `hasNextStep = computed(() => frameIndex < frames.length-1 || nextPlayableId != null)`

2. Redefine:

```ts
const canAutoAdvanceNow = computed(() =>
  hasFrames.value &&
  !isSceneTransitioning.value &&
  isFullyRevealed.value &&
  hasNextStep.value &&
  !isGenerationInProgress.value
);
```

(When generating: autoplay should idle-generation, not advance.)

## 6B) Fix `useAutoplay()` so it never turns itself off at end

### Work (in `player-composables.ts`)
- Remove the logic that stops autoplay when it can’t advance.
- Add a watch on a **cursor key** or `frameIndex + activeMessageId` so stage-click manual advances don’t double-step due to a stale timer:
  - If autoplaying and cursor changes, cancel & reschedule if `canAutoAdvanceNow`.

## 6C) Manual intervention rule: stop autoplay on non-stage-click actions

### Work (in controller)
- Remove this from `onStageClick()`:

```ts
if (isAutoplaying.value) { stopAutoplay(); return; }
```

- Instead: stage click skips reveal / advances but autoplay stays on.
- Add `stopAutoplay()` calls to:
  - transport button handlers (Restart / Prev / Next / Jump-to-latest)
  - message stepper +/- actions
  - applying typed message id (blur/change)

Implementation approach that works well:
- Keep internal navigation funcs (`stepForwardInternal`, etc.)
- Expose public “user action” funcs that call `stopAutoplay()` then call internal.

## 6D) Autoplay status (for diagnostics/UI)

### Work
Derived `autoplayStatus`:
- `off` if `!isAutoplaying`
- `idle-generation` if autoplaying + generation in progress
- `active` if autoplaying + canAutoAdvanceNow
- `idle-end` if autoplaying + !canAutoAdvanceNow + !generation

### Acceptance
- Autoplay bridges messages automatically.
- At end-of-chat, autoplay stays enabled and idles.
- When a new playable message arrives, autoplay wakes and continues.
- Manual navigation via buttons/stepper/input disables autoplay immediately.
- Stage click does **not** disable autoplay and does not cause double-advance.

---

# Phase 7 — Follow-latest persistence (spec #4)

### Work
1. **Remove** the side effect that disables follow-latest during manual message selection. (Currently `selectMessage()` sets `followLatestPlayable=false` — that must go.)

2. On `MESSAGE_RECEIVED(messageId)`:
- If `followLatestPlayable` and message is playable and not excluded:
  - snap `activeMessageId` to newest playable (typically `messageId`, or “latest playable”)
  - if snapping forward across messages, use the same seamless forward bridge behavior (pendingBridge from currentFrame → new frame 0)
- Do not re-enable autoplay (follow-latest is independent)

### Acceptance
- User can browse back (autoplay off), but when a new playable message arrives, the player snaps forward automatically as long as follow-latest remains enabled.

---

# Phase 8 — UI wiring + docs

### Work
1. Update `ViewportOverlay.vue` to call the new “user action” handlers (the ones that stop autoplay).
2. Update `context.md`:
- Cross-message navigation rules (forward seamless normal, backward instant)
- Stepper skips non-playables/hidden
- Generation safe-frame lock
- Autoplay idle + auto-resume
- Follow-latest persistence semantics

3. Add a regression test checklist (manual) covering:
- hidden messages between playables
- message boundary forward/back transitions with scene fades + sprite enter/exit
- generation lock while streaming + post-generation availability
- autoplay idle-end → resume on new message
- stage click while autoplaying (no double-step)

</plan>
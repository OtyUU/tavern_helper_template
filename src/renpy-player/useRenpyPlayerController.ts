import { klona } from 'klona';
import { storeToRefs } from 'pinia';
import { computed, onMounted, onScopeDispose, reactive, readonly, ref, watch } from 'vue';
import { buildFrames, getInitialState, parseScriptFromMessage } from './parser';
import {
  useAutoplay,
  useDialogueReveal,
  useReducedMotion,
  useScenePresentation,
  useSpriteVisibilityTransitions,
} from './player-composables';
import { useRenpyPlayerSettingsStore } from './settings';
import type { PlayerCameraIntent, PlayerFrame, SpritePosition } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

export function useRenpyPlayerController() {
  // ─── Store / settings wiring ───────────────────────────────────────────────

  const settingsStore = useRenpyPlayerSettingsStore();
  const {
    settings,
    assetExtensions,
    globalPoseTokens,
    characterSpriteConfig,
    characterSpriteConfigError,
  } = storeToRefs(settingsStore);

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
  function updateSettings(updater: (draft: typeof settings.value) => void): void {
    try {
      const draft = klona(settings.value);
      updater(draft);
      settings.value = draft;
    } catch (error) {
      console.error('[renpy-player] Failed to update settings:', error);
    }
  }

  // ─── Core derived model ────────────────────────────────────────────────────

  // Cursor coordinate 1/2: which message we're playing.
  // (Cursor coordinate 2/2 is frameIndex.)
  const activeMessageId = ref<number | null>(settings.value.preferredMessageId ?? null);

  type PendingBridge = { targetKey: string; prevFrame: PlayerFrame };
  const pendingBridge = ref<PendingBridge | null>(null);

  /**
   * Logical "previous frame" used for diffs (sprite swap duration, camera diffs, etc).
   *
   * Important: this must NOT be derived from displayed state, because displayed state
   * can be temporarily cleared during scene crossfades (midpoint), which would break
   * "previous" comparisons and cause swap durations to incorrectly become 0.
   *
   * This is set in the currentFrame watcher using the same effectivePrev frame passed
   * into applyFrame() (bridge-aware).
   */
  const prevFrameForDiff = ref<PlayerFrame | null>(null);

  type PendingFrameTarget = null | { kind: 'first' } | { kind: 'last' };
  const pendingFrameTarget = ref<PendingFrameTarget>(null);

  // currentMessage is derived (not stored) to allow cursor-based navigation later.
  // historyTrigger forces recomputation because getChatMessages() is not reactive.
  const currentMessage = computed<ChatMessage | null>(() => {
    void historyTrigger.value;
    const id = activeMessageId.value;
    if (id == null) return null;
    return getChatMessages(id)[0] ?? null;
  });

  // historyTrigger forces recomputation because getChatMessages() is not
  // reactive.  fullSync() increments it on chat events.
  const historyTrigger = ref(0);

  const frameIndex = ref(0);
  const manualMessageId = ref<number | null>(settings.value.preferredMessageId);
  const isSceneTransitioning = ref(false);

  // ─── Reduced motion ────────────────────────────────────────────────────────

  const {
    prefersReducedMotion,
    setup: setupReducedMotion,
    cleanup: cleanupReducedMotion,
  } = useReducedMotion();

  // Manual message jumps set motionMode = 'instant' and it stays that way
  // until the next navigation action calls setMotionModeForNav().
  const motionMode = ref<'normal' | 'instant'>('normal');

  const effectsDisabled = computed(
    () => prefersReducedMotion.value || motionMode.value === 'instant',
  );

  // ─── HUD hide/show & TransitionBus ─────────────────────────────────────────

  const hudShowInProgress = ref(false);
  let hudShowTimeout: number | null = null;

  function clearHudShowTimeout(): void {
    if (hudShowTimeout !== null) {
      window.clearTimeout(hudShowTimeout);
      hudShowTimeout = null;
    }
  }

  function cancelHudShow(): void {
    clearHudShowTimeout();
    hudShowInProgress.value = false;
  }

  function beginHudShow(): void {
    cancelHudShow();
    if (effectsDisabled.value || settings.value.hudShowDurationMs <= 0) {
      hudShowInProgress.value = false;
      return;
    }

    hudShowInProgress.value = true;
    hudShowTimeout = window.setTimeout(() => {
      hudShowTimeout = null;
      hudShowInProgress.value = false;
    }, settings.value.hudShowDurationMs);
  }

  /**
   * TransitionBus tracks in-flight visual transitions (scene crossfades, sprite animations, etc.)
   * Created early so it can be passed to useScenePresentation and useSpriteVisibilityTransitions.
   */
  const bus = useTransitionBus();

  const isHudHidden = computed(() => {
    if (effectsDisabled.value) return false;
    return settings.value.hudHideScope === 'all-motion'
      ? bus.count.value > 0
      : isSceneTransitioning.value;
  });

  watch(isHudHidden, (hidden, wasHidden) => {
    if (hidden) {
      cancelHudShow();
      return;
    }
    if (!wasHidden) return;
    beginHudShow();
  });

  // ─── Message switching helpers (dedupe) ───────────────────────────────────

  function switchToMessage(
    targetId: number,
    options: {
      motion?: 'normal' | 'instant';
      frameTarget?: 'first' | 'last';
      createBridge?: boolean;
    } = {},
  ): void {
    const { motion, frameTarget = 'first', createBridge = false } = options;
    const previousActiveId = activeMessageId.value;

    // If we're already on this message, do not reset frameIndex (important for fullSync behavior).
    if (previousActiveId === targetId) {
      updateSettings(draft => {
        draft.preferredMessageId = targetId;
      });
      manualMessageId.value = targetId;
      activeMessageId.value = targetId;
      return;
    }

    if (motion) {
      motionMode.value = motion;
    }

    if (createBridge) {
      const prevFrame = currentFrame.value;
      pendingBridge.value = prevFrame
        ? { targetKey: cursorKey(targetId, 0), prevFrame }
        : null;
    } else {
      pendingBridge.value = null;
    }

    if (frameTarget === 'last') {
      pendingFrameTarget.value = { kind: 'last' };
      frameIndex.value = Number.MAX_SAFE_INTEGER;
    } else {
      pendingFrameTarget.value = null;
      frameIndex.value = 0;
    }

    updateSettings(draft => {
      draft.preferredMessageId = targetId;
    });
    manualMessageId.value = targetId;
    activeMessageId.value = targetId;
  }

  function maybeFollowLatestPlayable(messageId: number): void {
    if (!settings.value.followLatestPlayable) return;
    if (excludedPlayableMessageIds.value.has(messageId)) return;

    const message = getChatMessages(messageId)[0];
    if (!isMessagePlayable(message)) return;

    const latestPlayable =
      playableMessageIds.value.length > 0
        ? playableMessageIds.value[playableMessageIds.value.length - 1]
        : messageId;

    switchToMessage(latestPlayable ?? messageId, {
      motion: 'normal',
      frameTarget: 'first',
      createBridge: true,
    });
  }

  // ─── Sprite visibility transitions ─────────────────────────────────────────

  const {
    onSpriteEnter,
    onSpriteLeave,
    prepareSpriteVisibilityEffects,
    clearSpriteVisibilityTransitions,
    triggerSpriteEnterAnimation,
  } = useSpriteVisibilityTransitions(
    settings,
    isSceneTransitioning,
    prefersReducedMotion,
    effectsDisabled,
    bus,
  );

  // ─── Scene presentation ────────────────────────────────────────────────────

  const {
    displayedBackground,
    displayedSprites,
    displayedCamera,
    displayedCameraAnimations,
    clearTransitionTimeouts,
    applyFrame,
    setBackgroundCameraElement,
    setSpriteCameraElement,
    trackSpritePositionTransitions,
  } = useScenePresentation(
    settings,
    isSceneTransitioning,
    prepareSpriteVisibilityEffects,
    effectsDisabled,
    bus,
    prefersReducedMotion,
    computed(() => settings.value.cameraTransitionMs),
  );

  const lifecycleStopList: Array<() => void> = [];

  const maxMessageId = computed(() => {
    void historyTrigger.value;
    return getLastMessageId();
  });
  const characterNaturalHeights = ref<Record<string, number>>({});
  const assetResolutionStatus = ref<Record<string, { resolved?: string; failed: string[] }>>({});

  const activeSwapTrackers = new Map<string, () => void>();

  type SmartImageSwapPayload = { duration: number };

  function clampMs(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.round(value));
  }

  function onSmartImageSwapStart(key: string, payload: SmartImageSwapPayload): void {
    if (effectsDisabled.value) return;
    if (phase.value !== 'scene') return;

    if (key === '__background__' && isSceneTransitioning.value) return;

    const durationMs = clampMs(payload?.duration ?? 0, 0);
    if (durationMs <= 0) return;

    activeSwapTrackers.get(key)?.();

    let finished = false;
    let timeoutHandle: number | null = null;

    const cancel = () => {
      if (finished) return;
      finished = true;
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      activeSwapTrackers.delete(key);
    };

    const cleanupBus = bus.register(cancel);

    const complete = () => {
      if (finished) return;
      finished = true;
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      cleanupBus();
      activeSwapTrackers.delete(key);
    };

    timeoutHandle = window.setTimeout(complete, durationMs + 75);

    activeSwapTrackers.set(key, complete);
  }

  onScopeDispose(() => {
    activeSwapTrackers.forEach(cleanup => cleanup());
    activeSwapTrackers.clear();
  });

  // ─── Playable message state ────────────────────────────────────────────────

  const playableMessageIds = ref<number[]>([]);
  const excludedPlayableMessageIds = ref<Set<number>>(new Set());
  const isGenerationInProgress = ref(false);
  const generationTargetMessageId = ref<number | null>(null);
  const generationTargetConfirmed = ref(false);

  function cursorKey(messageId: number | null, frame: number): string {
    return `${messageId ?? 'none'}:${frame}`;
  }

  const currentCursorKey = computed(() => cursorKey(activeMessageId.value, frameIndex.value));

  const autoplayStatus = computed<'off' | 'active' | 'idle-end' | 'idle-generation'>(() => {
    if (!isAutoplaying.value) return 'off';
    if (isGenerationInProgress.value) return 'idle-generation';
    if (canAutoAdvanceNow.value) return 'active';
    return 'idle-end';
  });

  // ─── Playable message index ────────────────────────────────────────────────

  function isMessagePlayable(msg: ChatMessage | undefined | null): boolean {
    if (!msg) return false;
    if (msg.is_hidden) return false;
    return parseScriptFromMessage(msg.message ?? '').commands.length > 0;
  }

  function rebuildPlayableIndex() {
    const last = getLastMessageId();
    if (last < 0) {
      playableMessageIds.value = [];
      return;
    }
    const all = getChatMessages(`0-${last}`);
    const excluded = excludedPlayableMessageIds.value;
    playableMessageIds.value = all
      .filter(m => m && !excluded.has(m.message_id) && isMessagePlayable(m))
      .map(m => m!.message_id)
      .sort((a, b) => a - b);
  }

  function findPrevPlayableId(id: number | null): number | null {
    if (id === null) return null;
    const ids = playableMessageIds.value;
    let left = 0;
    let right = ids.length - 1;
    let result: number | null = null;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (ids[mid] < id) {
        result = ids[mid];
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return result;
  }

  function findNextPlayableId(id: number | null): number | null {
    if (id === null) return null;
    const ids = playableMessageIds.value;
    let left = 0;
    let right = ids.length - 1;
    let result: number | null = null;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (ids[mid] > id) {
        result = ids[mid];
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return result;
  }

  const prevPlayableId = computed(() => findPrevPlayableId(activeMessageId.value));
  const nextPlayableId = computed(() => findNextPlayableId(activeMessageId.value));

  // ─── Generation lock ───────────────────────────────────────────────────────

  type GenerationStartedOption = {
    automatic_trigger?: boolean;
    force_name2?: boolean;
    quiet_prompt?: string;
    quietToLoud?: boolean;
    skipWIAN?: boolean;
    force_chid?: number;
    signal?: AbortSignal;
    quietImage?: string;
    quietName?: string;
    depth?: number;
  };

  function predictGenerationTargetMessageId(): number | null {
    const last = getLastMessageId();
    if (last < 0) return null;

    const lastMsg = getChatMessages(last)[0];
    if (lastMsg?.role === 'user') {
      return last + 1;
    }

    return last;
  }

  function jumpToSafeFrameBefore(excludedMessageId: number) {
    const safeId =
      findPrevPlayableId(excludedMessageId) ??
      resolveNearestPlayableId(excludedMessageId);

    if (safeId == null) {
      pendingBridge.value = null;
      pendingFrameTarget.value = null;
      cancelAllEffects('jumpToSafeFrameBefore: no safeId');
      activeMessageId.value = null;
      manualMessageId.value = null;
      updateSettings(draft => {
        draft.preferredMessageId = null;
      });
      frameIndex.value = 0;
      return;
    }

    if (activeMessageId.value === safeId && !excludedPlayableMessageIds.value.has(safeId)) {
      return;
    }

    cancelAllEffects('jumpToSafeFrameBefore');
    const shouldGoLast = safeId < excludedMessageId;
    switchToMessage(safeId, {
      motion: 'instant',
      frameTarget: shouldGoLast ? 'last' : 'first',
      createBridge: false,
    });
  }

  function beginGenerationLock(
    type?: string,
    option?: GenerationStartedOption,
    dryRun?: boolean,
  ) {
    if (dryRun) {
      return;
    }

    if (
      type === 'quiet' ||
      option?.quiet_prompt ||
      option?.quietImage ||
      option?.quietName
    ) {
      return;
    }

    isGenerationInProgress.value = true;
    generationTargetConfirmed.value = false;

    const previousTarget = generationTargetMessageId.value;
    if (previousTarget != null) {
      excludedPlayableMessageIds.value.delete(previousTarget);
    }

    const predictedTarget = predictGenerationTargetMessageId();
    generationTargetMessageId.value = predictedTarget;

    if (predictedTarget == null) {
      rebuildPlayableIndex();
      return;
    }

    excludedPlayableMessageIds.value.add(predictedTarget);
    rebuildPlayableIndex();

    if (activeMessageId.value === predictedTarget || settings.value.preferredMessageId === predictedTarget) {
      jumpToSafeFrameBefore(predictedTarget);
    }
  }

  function endGenerationLock(messageId?: number | null) {
    isGenerationInProgress.value = false;
    generationTargetConfirmed.value = false;

    const predictedOrLocked = generationTargetMessageId.value;
    const targetFromEvent = messageId ?? null;
    generationTargetMessageId.value = null;

    if (targetFromEvent != null) {
      excludedPlayableMessageIds.value.delete(targetFromEvent);
    }
    if (predictedOrLocked != null) {
      excludedPlayableMessageIds.value.delete(predictedOrLocked);
    }

    rebuildPlayableIndex();
  }

  const characterNormalizationScales = computed(() => {
    const scales: Record<string, number> = {};
    for (const charId in characterNaturalHeights.value) {
      const refHeight = getSpriteReferenceHeight(charId);
      const natHeight = characterNaturalHeights.value[charId];
      scales[charId] = natHeight > 0 ? refHeight / natHeight : 1;
    }
    return scales;
  });

  const parsedScript = computed(
    () => parseScriptFromMessage(currentMessage.value?.message ?? ''),
  );

  const buildOptions = computed(() => ({
    assetRoot: settings.value.assetRoot,
    assetExtensions: assetExtensions.value,
    characterSpriteConfig: characterSpriteConfig.value,
    defaultPose: settings.value.defaultPose,
    defaultExpression: settings.value.defaultExpression,
    globalPoseTokens: globalPoseTokens.value,
  }));

  const inheritedState = computed(() => {
    void historyTrigger.value;

    const history: string[] = [];
    const currentId = currentMessage.value?.message_id;
    if (currentId != null && !Number.isNaN(currentId) && currentId > 0) {
      const allMessages = getChatMessages(`0-${currentId - 1}`);
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (!msg?.message) continue;
        if (msg.is_hidden) continue;
        history.push(msg.message);
      }
    }

    return getInitialState(history, buildOptions.value);
  });

  const frames = computed(() =>
    buildFrames(parsedScript.value, {
      ...buildOptions.value,
      initialState: inheritedState.value,
    }),
  );

  const currentFrame = computed(() => frames.value[frameIndex.value] ?? null);

  const {
    graphemes,
    revealedCharCount,
    displayedSpeaker,
    speakerRevealed,
    isRevealing,
    isFullyRevealed,
    skipReveal,
    clearReveal,
    beginReveal,
  } = useDialogueReveal(settings, currentFrame, effectsDisabled);

  // ─── Phase FSM ─────────────────────────────────────────────────────────────
  
  const blockReveal = computed(
    () => !effectsDisabled.value && hudShowInProgress.value,
  );

  /**
   * Phase FSM coordinates dialogue reveal timing based on animation completion.
   * Uses the TransitionBus created earlier to track in-flight visual transitions.
   */
  const { phase, isBusy: phaseBusy, resetToScene, applyNextFrame, applyFrameIndex } = useFramePhase(
    bus,
    frameIndex,
    frames,
    currentFrame,
    isFullyRevealed,
    beginReveal,
    effectsDisabled,
    blockReveal,
  );

  const dialogueTextFull = computed(
    () => currentFrame.value?.text ?? 'No dialogue on this frame.',
  );

  const autoAdvanceDelayMs = computed(() => settings.value.autoAdvanceDelayMs);

  const hasFrames = computed(() => frames.value.length > 0);
  
  const isBusy = computed(() => phaseBusy.value);
  
  const canRestart = computed(() => hasFrames.value && frameIndex.value > 0);
  const canStepBack = computed(
    () => hasFrames.value && (frameIndex.value > 0 || prevPlayableId.value !== null),
  );
  const canStepForward = computed(
    () =>
      hasFrames.value &&
      (frameIndex.value < frames.value.length - 1 || nextPlayableId.value !== null) &&
      !isBusy.value,
  );

  const hasNextStep = computed(
    () => hasFrames.value && (frameIndex.value < frames.value.length - 1 || nextPlayableId.value !== null),
  );

  /** Autoplay advances only after phase === 'done' (scene + reveal complete). */
  const canAutoAdvanceNow = computed(
    () =>
      hasFrames.value &&
      phase.value === 'done' &&
      hasNextStep.value &&
      !isGenerationInProgress.value,
  );
  const canSelectPreviousMessage = computed(() => prevPlayableId.value !== null);
  const canSelectNextMessage = computed(() => nextPlayableId.value !== null);

  // ─── Stage geometry & presentation ─────────────────────────────────────────

  function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function formatMs(value: number): string {
    return `${Math.max(0, value)}ms`;
  }

  /** Returns `0ms` when effects are disabled; otherwise formats as `${value}ms`. */
  function msOrZero(value: number): string {
    return effectsDisabled.value ? '0ms' : formatMs(value);
  }

  /** Returns `0ms` when disabled; otherwise formats as `${value}ms`. */
  function msOrZeroWhen(enabled: boolean, value: number): string {
    return enabled ? formatMs(value) : '0ms';
  }

  type HudScaledPxVarDef = {
    name: `--${string}`;
    base: number;
    min: number;
    max: number;
  };

  const HUD_SCALED_PX_VARS: HudScaledPxVarDef[] = [
    { name: '--renpy-dialogue-min-height', base: 110, min: 80, max: 160 },
    { name: '--renpy-dialogue-pad-x', base: 40, min: 20, max: 60 },
    { name: '--renpy-dialogue-pad-top', base: 16, min: 12, max: 24 },
    { name: '--renpy-dialogue-pad-bottom', base: 16, min: 12, max: 24 },
    { name: '--renpy-dialogue-gap', base: 24, min: 16, max: 40 },

    { name: '--renpy-speaker-col', base: 140, min: 100, max: 180 },
    { name: '--renpy-speaker-size', base: 24, min: 18, max: 32 },
    { name: '--renpy-text-size', base: 18, min: 14, max: 24 },

    { name: '--renpy-rail-width', base: 214, min: 180, max: 272 },
    { name: '--renpy-control-gap', base: 6, min: 4, max: 10 },
    { name: '--renpy-control-icon', base: 20, min: 16, max: 26 },
    { name: '--renpy-control-button-width', base: 42, min: 34, max: 52 },
    { name: '--renpy-control-button-height', base: 34, min: 28, max: 42 },
    { name: '--renpy-control-row-pad-x', base: 6, min: 4, max: 10 },
    { name: '--renpy-control-row-pad-y', base: 8, min: 6, max: 12 },
    { name: '--renpy-stepper-button-size', base: 20, min: 18, max: 26 },
    { name: '--renpy-stepper-input-width', base: 34, min: 30, max: 44 },
    { name: '--renpy-meta-size', base: 10, min: 9, max: 12 },
    { name: '--renpy-input-size', base: 13, min: 11, max: 17 },
  ];

  function resolveHudScaledPxVars(scale: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const def of HUD_SCALED_PX_VARS) {
      out[def.name] = `${clampNumber(Math.round(def.base * scale), def.min, def.max)}px`;
    }
    return out;
  }

  const stageWidth = computed(() => Math.round(settings.value.stageHeight * 16 / 9));
  const hudScale = computed(() => clampNumber(settings.value.stageHeight / 480, 0.72, 1.42));

  const stageWrapStyle = computed(() => ({
    height: `${settings.value.stageHeight}px`,
  }));

  const stageStyle = computed(() => {
    const scale = hudScale.value;
    return {
      width: `${stageWidth.value}px`,
      height: `${settings.value.stageHeight}px`,
      '--renpy-camera-transition-ms': msOrZeroWhen(
        !(effectsDisabled.value || isSceneTransitioning.value),
        settings.value.cameraTransitionMs,
      ),
      '--stage-height': `${settings.value.stageHeight}px`,
      '--renpy-ui-scale': scale.toFixed(3),

      '--renpy-shell-pad-x': `0px`,
      '--renpy-shell-pad-bottom': `0px`,
      '--renpy-shell-gap': `0px`,

      ...resolveHudScaledPxVars(scale),

      '--renpy-text-fade-ms': msOrZero(settings.value.textFadeMs),
      '--renpy-speaker-fade-ms': msOrZero(settings.value.speakerFadeMs),
      '--renpy-hud-hide-ms': msOrZero(settings.value.hudHideDurationMs),
      '--renpy-hud-show-ms': msOrZero(settings.value.hudShowDurationMs),
      '--renpy-hud-hide-drift-ms': msOrZero(Math.round(settings.value.hudHideDurationMs * 1.25)),
      '--renpy-hud-drift-px': `${settings.value.hudHideDriftPx}px`,

      '--renpy-sprite-offset-y': `${Math.round(
        settings.value.spriteBaselineOffsetPx * settings.value.stageHeight / 480,
      )}px`,
      '--sprite-y': 'var(--renpy-sprite-offset-y, 0px)',
    };
  });

  function resolveActiveCameraPreset(intent?: PlayerCameraIntent) {
    const transform = intent?.preset;
    if (transform === 'closeup') {
      return {
        backgroundScale: settings.value.closeupBackgroundScale,
        spriteScale: settings.value.closeupSpriteScale,
        spriteY: settings.value.closeupSpriteY,
      };
    }

    if (transform === 'medium') {
      return {
        backgroundScale: settings.value.mediumBackgroundScale,
        spriteScale: settings.value.mediumSpriteScale,
        spriteY: settings.value.mediumSpriteY,
      };
    }

    return {
      backgroundScale: settings.value.defaultBackgroundScale,
      spriteScale: settings.value.defaultSpriteScale,
      spriteY: settings.value.defaultSpriteY,
    };
  }

  const activeCameraPreset = computed(() =>
    resolveActiveCameraPreset(displayedCamera.value),
  );

  const cameraPanXPx = computed(() => {
    const pct = displayedCamera.value?.panXPct ?? 0;
    return Math.round(stageWidth.value * (pct / 100));
  });

  const cameraPanYPx = computed(() => {
    const presetPct = activeCameraPreset.value.spriteY ?? 0;
    const intentPct = displayedCamera.value?.panYPct ?? 0;
    return Math.round(settings.value.stageHeight * ((presetPct + intentPct) / 100));
  });

  const zoom = computed(() => activeCameraPreset.value.backgroundScale);

  const resolvedCameraTransitionMs = computed(() =>
    (effectsDisabled.value || isSceneTransitioning.value) ? 0 : settings.value.cameraTransitionMs,
  );

  const backgroundCameraStyle = computed(() => {
    const mult = settings.value.bgPanParallax ?? 1;
    const ms = resolvedCameraTransitionMs.value;
    return {
      transform: `translate(${cameraPanXPx.value * mult}px, ${cameraPanYPx.value * mult}px) scale(${zoom.value})`,
      transformOrigin: 'center center',
      transition: ms > 0 ? `transform ${ms}ms ease` : 'none',
    };
  });

  const spriteCameraStyle = computed(() => {
    const ms = resolvedCameraTransitionMs.value;
    return {
      transform: `translate(${cameraPanXPx.value}px, ${cameraPanYPx.value}px) scale(${zoom.value})`,
      transformOrigin: 'center center',
      transition: ms > 0 ? `transform ${ms}ms ease` : 'none',
    };
  });

  const spriteStyle = computed(() => {
    return {
      '--sprite-scale': '1',
    };
  });

  const cameraAnimationClass = computed(
    () => getCameraAnimationClass(displayedCameraAnimations.value),
  );

  const cameraDiagnosticsLabel = computed(() => {
    const parts = [
      displayedCamera.value?.preset ?? 'default',
      `panY:${cameraPanYPx.value}px`,
      ...(displayedCameraAnimations.value ?? []),
    ];
    return parts.join(', ');
  });

  // ─── Camera shake tracking ─────────────────────────────────────────────────

  /**
   * Camera shake duration (matches CSS .renpy-player__scene-layer--shake animation).
   */
  const CAMERA_SHAKE_DURATION_MS = 450;

  /** Registers camera shake with TransitionBus; auto-cleans up after duration. */
  watch(
    cameraAnimationClass,
    (newClass, oldClass) => {
      if (newClass !== 'renpy-player__scene-layer--shake') return;
      if (effectsDisabled.value) return;
      if (newClass === oldClass) return;

      let timeoutHandle: number | undefined;
      const cleanup = bus.register(() => {
        if (timeoutHandle !== undefined) {
          window.clearTimeout(timeoutHandle);
        }
      });

      timeoutHandle = window.setTimeout(() => {
        cleanup();
      }, CAMERA_SHAKE_DURATION_MS);
    },
    { flush: 'post' }
  );

  const renderedSprites = computed(() => {
    return (displayedSprites.value ?? []).map(sprite => {
      const referenceHeight = getSpriteReferenceHeight(sprite.id);
      const normalizationScale = getSpriteNormalizationScale(sprite);

      return {
        ...sprite,
        renderKey: sprite.id,
        animationClass: getSpriteAnimationClass(sprite.animations),
        shellStyle: {
          ...getSpriteShellStyle(sprite.position),
          '--sprite-ref-height': `${referenceHeight}px`,
          '--sprite-normalize-scale': `${normalizationScale}`,
        },
        swapDurationMs: getSpriteSwapDuration(sprite),
      };
    });
  });

  function getSpriteReferenceHeight(spriteId: string): number {
    return characterSpriteConfig.value[spriteId]?.referenceHeight ?? settings.value.spriteReferenceHeight;
  }

  function getSpriteNaturalHeight(sprite: PlayerFrame['sprites'][number]): number {
    return characterNaturalHeights.value[sprite.id] ?? getSpriteReferenceHeight(sprite.id);
  }

  function getSpriteNormalizationScale(sprite: PlayerFrame['sprites'][number]): number {
    return characterNormalizationScales.value[sprite.id] ?? 1;
  }

  function onSpriteResolved(
    spriteId: string,
    payload: { naturalHeight: number },
  ) {
    if (characterNaturalHeights.value[spriteId] === undefined) {
      characterNaturalHeights.value[spriteId] = payload.naturalHeight;
    }
    triggerSpriteEnterAnimation(spriteId);
  }

  function onAssetResolutionStatus(
    key: string,
    status: { resolved?: string | null; failed: string[] },
  ) {
    assetResolutionStatus.value[key] = {
      resolved: status.resolved ?? undefined,
      failed: status.failed,
    };
  }

  function getSpriteAnchorXPct(position: SpritePosition): number {
    const C = settings.value.spriteCenterX;
    const M = settings.value.spriteMidSpacing;
    const S = settings.value.spriteSideSpacing;
    const F = settings.value.spriteFarSpacing;
    const offsets: Record<SpritePosition, number> = {
      farleft:  -F,
      left:     -S,
      midleft:  -M,
      center:    0,
      midright:  M,
      right:     S,
      farright:  F,
    };
    return clampNumber(C + offsets[position], 0, 100);
  }

  function getSpriteAnchorXPx(position: SpritePosition): number {
    const xPct = getSpriteAnchorXPct(position);
    return Math.round(stageWidth.value * (xPct / 100));
  }

  function getSpriteShellStyle(position: SpritePosition) {
    const xPx = getSpriteAnchorXPx(position);
    return { transform: `translate3d(${xPx}px, 0, 0) translateX(-50%)` };
  }

  function getSpriteSwapDuration(sprite: PlayerFrame['sprites'][number]): number {
    if (effectsDisabled.value) {
      return 0;
    }

    const prevSprites = prevFrameForDiff.value?.sprites ?? [];
    const previousSprite = prevSprites.find(candidate => candidate.id === sprite.id);
    if (!previousSprite?.asset || !sprite.asset || previousSprite.asset.description === sprite.asset.description) {
      return 0;
    }

    const isPoseChange =
      previousSprite.pose !== sprite.pose ||
      previousSprite.outfit !== sprite.outfit;

    if (isPoseChange) {
      return settings.value.poseChangeMs;
    }

    const isExpressionChange =
      previousSprite.expression !== sprite.expression ||
      previousSprite.blush !== sprite.blush;

    if (isExpressionChange) {
      return settings.value.expressionChangeMs;
    }

    return settings.value.poseChangeMs;
  }

  const sceneFadeStyle = computed(() => ({
    animationDuration: `${settings.value.sceneTransitionMs}ms`,
  }));

  watch(
    () => currentFrame.value,
    (nextFrame, previousFrame) => {
      const bridge = pendingBridge.value;
      const nextKey =
        nextFrame && activeMessageId.value != null
          ? cursorKey(activeMessageId.value, nextFrame.index)
          : '';

      const effectivePrev =
        bridge && bridge.targetKey === nextKey
          ? bridge.prevFrame
          : (previousFrame ?? null);

      if (bridge && bridge.targetKey === nextKey) {
        pendingBridge.value = null;
      }

      prevFrameForDiff.value = nextFrame ? effectivePrev : null;

      if (nextFrame !== previousFrame) {
        resetToScene('currentFrame changed');
        clearReveal();
        cancelHudShow();
      }

      applyFrame(nextFrame, effectivePrev);
    },
    { immediate: true },
  );

  // ─── Scene presentation helpers ────────────────────────────────────────────

  function getSpriteAnimationClass(animations?: string[]): string | undefined {
    if (effectsDisabled.value || !animations?.length) {
      return undefined;
    }
    if (animations.includes('shake')) {
      return 'renpy-player__sprite--shake';
    }
    if (animations.includes('bounce')) {
      return 'renpy-player__sprite--bounce';
    }
    if (animations.includes('pulse')) {
      return 'renpy-player__sprite--pulse';
    }
    return undefined;
  }

  function getCameraAnimationClass(animations?: string[]): string | undefined {
    if (effectsDisabled.value || !animations?.length) {
      return undefined;
    }
    if (animations.includes('shake')) {
      return 'renpy-player__scene-layer--shake';
    }
    return undefined;
  }

  // ─── Actions (selection, transport) ────────────────────────────────────────

  function fullSync(
    options: { rebuildIndex?: boolean; forceMessageId?: number | null } = {},
  ) {
    if (options.rebuildIndex !== false) {
      rebuildPlayableIndex();
    }

    historyTrigger.value++;

    const messageId =
      'forceMessageId' in options
        ? (options.forceMessageId ?? null)
        : (settings.value.followLatestPlayable
          ? (playableMessageIds.value.length > 0
            ? playableMessageIds.value[playableMessageIds.value.length - 1]
            : null)
          : settings.value.preferredMessageId);

    const previousActiveId = activeMessageId.value;

    updateSettings(draft => {
      draft.preferredMessageId = messageId;
    });
    manualMessageId.value = messageId;
    activeMessageId.value = messageId;

    // Preserve prior behavior: switching messages starts from frame 0.
    // (But edits/refreshes of the same message no longer forcibly reset.)
    if (messageId !== previousActiveId) {
      frameIndex.value = 0;
      motionMode.value = 'normal';
    }
  }

  function refreshCurrentMessageOnly() {
    // currentMessage is computed; bump the trigger to force re-read.
    if (activeMessageId.value != null) {
      historyTrigger.value++;
    }
  }

  function onMessageReceived(messageId: number) {
    if (settings.value.followLatestPlayable) {
      maybeFollowLatestPlayable(messageId);
      return;
    }

    const preferred = settings.value.preferredMessageId;
    if (preferred != null && messageId > preferred) {
      return;
    }

    fullSync({ rebuildIndex: false });
  }

  /** Like onMessageReceived but for user-sent messages. Respects followLatestPlayable and generation lock. */
  function onMessageSent(messageId: number): void {
    maybeFollowLatestPlayable(messageId);
  }

  function onMessageChanged(messageId: number) {
    const currentId = activeMessageId.value;

    if (currentId === messageId) {
      refreshCurrentMessageOnly();
      return;
    }

    if (currentId != null && messageId < currentId) {
      fullSync({ rebuildIndex: false });
      return;
    }
  }

  /**
   * Confirms generation target on first MESSAGE_UPDATED, updates exclusions,
   * and jumps to safe frame if active message becomes the target.
   * Falls through to onMessageChanged for non-target messages.
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

    rebuildPlayableIndex();
    onMessageChanged(messageId);
  }

  /** Routes MESSAGE_UPDATED during generation to special handling; otherwise rebuilds index + onMessageChanged. */
  function handleMessageModified(messageId: number, eventType: string): void {
    try {
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

  function resolveNearestPlayableId(requestedId: number): number | null {
    const ids = playableMessageIds.value;
    if (ids.length === 0) return null;

    let left = 0;
    let right = ids.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const candidate = ids[mid];
      if (candidate === requestedId) return candidate;
      if (candidate < requestedId) left = mid + 1;
      else right = mid - 1;
    }

    const prev = right >= 0 ? ids[right] : null;
    const next = left < ids.length ? ids[left] : null;
    return prev ?? next;
  }

  function useLatestPlayable() {
    updateSettings(draft => {
      draft.followLatestPlayable = true;
    });
    fullSync();
    frameIndex.value = 0;
  }

  function selectMessage(messageId: number) {
    fullSync({ forceMessageId: messageId });
    frameIndex.value = 0;
  }

  function applyManualMessageIdInternal() {
    if (manualMessageId.value === null || Number.isNaN(manualMessageId.value)) {
      return;
    }
    manualMessageId.value = clampNumber(
      Math.round(manualMessageId.value),
      0,
      maxMessageId.value,
    );

    const targetId = resolveNearestPlayableId(manualMessageId.value);
    if (targetId === null) return;
    manualMessageId.value = targetId;

    switchToMessage(targetId, {
      motion: 'instant',
      frameTarget: 'first',
      createBridge: false,
    });
  }

  function onManualMessageInput(event: Event) {
    const nextValue = (event.target as HTMLInputElement).value.replace(/[^\d]/g, '');
    manualMessageId.value = nextValue === '' ? null : Number(nextValue);
  }

  function nudgeManualMessageIdInternal(delta: number) {
    const targetId = delta < 0 ? prevPlayableId.value : nextPlayableId.value;
    if (targetId == null) return;
    manualMessageId.value = targetId;
    applyManualMessageIdInternal();
  }

  function setMotionModeForNav(targetIndex: number) {
    motionMode.value = targetIndex < frameIndex.value ? 'instant' : 'normal';
  }

  function cancelAllEffects(reason?: string) {
    resetToScene(reason ?? 'cancelAllEffects');
    clearReveal();
    clearTransitionTimeouts();
    clearSpriteVisibilityTransitions();
    isSceneTransitioning.value = false;
  }

  function jumpToStartInternal() {
    setMotionModeForNav(0);
    applyFrameIndex(0);
  }

  function stepBackwardInternal() {
    if (!hasFrames.value) return;

    if (frameIndex.value > 0) {
      const target = Math.max(0, frameIndex.value - 1);
      setMotionModeForNav(target);
      applyNextFrame('backward');
      return;
    }

    const prevId = prevPlayableId.value;
    if (prevId == null) {
      return;
    }

    cancelAllEffects('stepBackwardInternal: cross-message');
    switchToMessage(prevId, { motion: 'instant', frameTarget: 'last', createBridge: false });
  }

  function stepForwardInternal() {
    if (isBusy.value) {
      return;
    }
    if (!hasFrames.value) return;

    if (frameIndex.value < frames.value.length - 1) {
      const target = Math.min(frames.value.length - 1, frameIndex.value + 1);
      setMotionModeForNav(target);
      applyNextFrame('forward');
      return;
    }

    const nextId = nextPlayableId.value;
    if (nextId == null) {
      return;
    }

    switchToMessage(nextId, { motion: 'normal', frameTarget: 'first', createBridge: true });
  }

  /** VN-style click: scene→ignore, reveal→skip text, done→advance frame. */
  function onStageClick() {
    if (!hasFrames.value) {
      return;
    }

    if (phase.value === 'scene') {
      return;
    }

    if (phase.value === 'reveal') {
      skipReveal();
      return;
    }

    if (phase.value === 'done') {
      if (canStepForward.value) {
        stepForwardInternal();
      }
      return;
    }
  }

  // ─── Autoplay ──────────────────────────────────────────────────────────────

  const canToggleAutoplay = computed(() => {
    if (isAutoplaying.value) return true;
    return hasFrames.value && !isBusy.value && hasNextStep.value;
  });

  const { isAutoplaying, stopAutoplay, toggleAutoplay } = useAutoplay(
    frames,
    canToggleAutoplay,
    canAutoAdvanceNow,
    autoAdvanceDelayMs,
    stepForwardInternal,
    currentCursorKey,
  );

  function jumpToStart() {
    stopAutoplay();
    jumpToStartInternal();
  }

  function stepBackward() {
    stopAutoplay();
    stepBackwardInternal();
  }

  function stepForward() {
    stopAutoplay();
    stepForwardInternal();
  }

  function useLatestPlayableUser() {
    stopAutoplay();
    useLatestPlayable();
  }

  function applyManualMessageId() {
    stopAutoplay();
    applyManualMessageIdInternal();
  }

  function nudgeManualMessageId(delta: number) {
    stopAutoplay();
    nudgeManualMessageIdInternal(delta);
  }

  // ─── Cross-cutting watchers ────────────────────────────────────────────────

  watch(
    frames,
    nextFrames => {
      if (pendingFrameTarget.value?.kind === 'last') {
        frameIndex.value = nextFrames.length === 0 ? 0 : nextFrames.length - 1;
        pendingFrameTarget.value = null;
        return;
      }

      if (pendingFrameTarget.value?.kind === 'first') {
        frameIndex.value = 0;
        pendingFrameTarget.value = null;
        return;
      }

      frameIndex.value =
        nextFrames.length === 0
          ? 0
          : Math.min(frameIndex.value, nextFrames.length - 1);
    },
    { immediate: true },
  );

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMounted(() => {
    setupReducedMotion();

    fullSync();

    lifecycleStopList.push(
      eventOn(tavern_events.CHAT_CHANGED, () => {
        fullSync();
      }).stop,
      eventOn(tavern_events.MESSAGE_RECEIVED, (messageId: number) => {
        rebuildPlayableIndex();
        onMessageReceived(messageId);
      }).stop,
      eventOn(tavern_events.MESSAGE_SENT, (messageId: number) => {
        try {
          rebuildPlayableIndex();
          onMessageSent(messageId);
        } catch (error) {
          console.error(`[renpy-player] Error handling MESSAGE_SENT for message ${messageId}:`, error);
        }
      }).stop,
      eventOn(tavern_events.MESSAGE_EDITED, (messageId: number) => {
        handleMessageModified(messageId, 'MESSAGE_EDITED');
      }).stop,
      eventOn(tavern_events.MESSAGE_UPDATED, (messageId: number) => {
        handleMessageModified(messageId, 'MESSAGE_UPDATED');
      }).stop,
      eventOn(tavern_events.GENERATION_STARTED, (type: string, option: any, dry_run: boolean) => {
        beginGenerationLock(type, option as GenerationStartedOption, dry_run);
      }).stop,
      eventOn(tavern_events.GENERATION_ENDED, (messageId: number) => {
        endGenerationLock(messageId);
      }).stop,
      eventOn(tavern_events.GENERATION_STOPPED, () => {
        endGenerationLock(generationTargetMessageId.value);
      }).stop,
      eventOn(tavern_events.MESSAGE_DELETED, () => {
        fullSync();
      }).stop,
      eventOn(tavern_events.MESSAGE_SWIPED, (messageId: number) => {
        handleMessageModified(messageId, 'MESSAGE_SWIPED');
      }).stop,
      eventOn(tavern_events.MORE_MESSAGES_LOADED, () => {
        fullSync();
      }).stop,
    );
  });

  onScopeDispose(() => {
    cleanupReducedMotion();

    lifecycleStopList.forEach(stop => stop());
    lifecycleStopList.length = 0;

    stopAutoplay();
    clearReveal();
    clearTransitionTimeouts();
    clearSpriteVisibilityTransitions();

    cancelHudShow();

    bus.dispose();

    isGenerationInProgress.value = false;
    generationTargetMessageId.value = null;
    excludedPlayableMessageIds.value.clear();
  });

  // ─── Public API ────────────────────────────────────────────────────────────

  return reactive({
    model: {
      parsedScript,
      frames,
      frameIndex: readonly(frameIndex),
      currentFrame,
      hasFrames,
      maxMessageId,
    },

    phase: {
      phase: readonly(phase),
      isBusy: readonly(isBusy),
    },

    stage: {
      stageWrapStyle,
      stageStyle,
      onStageClick,
    },

    scene: {
      displayedBackground,
      renderedSprites,
      isSceneTransitioning: readonly(isSceneTransitioning),
      isHudHidden,
      sceneFadeStyle,
      backgroundCameraStyle,
      spriteCameraStyle,
      spriteStyle,
      cameraAnimationClass,
      cameraDiagnosticsLabel,
      onSpriteEnter,
      onSpriteLeave,
      onSpriteResolved,
      setBackgroundCameraElement,
      setSpriteCameraElement,
      trackSpritePositionTransitions,
      onSmartImageSwapStart,
    },

    dialogue: {
      displayedSpeaker,
      dialogueTextFull,
      graphemes,
      revealedCharCount,
      speakerRevealed,
      isRevealing,
    },

    transport: {
      canRestart,
      canStepBack,
      canStepForward,
      jumpToStart,
      stepBackward,
      stepForward,
    },

    selection: {
      manualMessageId,
      canSelectPreviousMessage,
      canSelectNextMessage,
      onManualMessageInput,
      applyManualMessageId,
      nudgeManualMessageId,
      useLatestPlayable: useLatestPlayableUser,
    },

    autoplay: {
      isAutoplaying,
      canToggleAutoplay,
      toggleAutoplay,
      stopAutoplay,
    },

    diagnostics: {
      characterSpriteConfigError,
      getSpriteReferenceHeight,
      getSpriteNaturalHeight,
      getSpriteNormalizationScale,
      assetResolutionStatus,
      onAssetResolutionStatus,
      // Phase 0 instrumentation:
      activeMessageId: readonly(activeMessageId),
      playableMessageIds: readonly(playableMessageIds),
      playableMessageCount: computed(() => playableMessageIds.value.length),
      playableMessageRange: computed(() => {
        const ids = playableMessageIds.value;
        if (ids.length === 0) return null;
        return { first: ids[0], last: ids[ids.length - 1] };
      }),
      prevPlayableId: readonly(prevPlayableId),
      nextPlayableId: readonly(nextPlayableId),
      isGenerationInProgress: readonly(isGenerationInProgress),
      generationTargetMessageId: readonly(generationTargetMessageId),
      autoplayStatus,
      currentCursorKey,
      cursorKey,
    },
  });
}

export type RenpyPlayerController = ReturnType<typeof useRenpyPlayerController>;

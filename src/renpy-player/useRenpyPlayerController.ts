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
import type { PlayerFrame } from './types';
import { useFramePhase } from './useFramePhase';
import { useTransitionBus } from './useTransitionBus';

export function useRenpyPlayerController() {
  // ─── Store / settings wiring ──────────────────────────────────────────────

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

  // ─── Core derived model ───────────────────────────────────────────────────

  // Cursor coordinate 1/2: which message we're playing.
  // (Cursor coordinate 2/2 is frameIndex.)
  const activeMessageId = ref<number | null>(settings.value.preferredMessageId ?? null);

  type PendingBridge = { targetKey: string; prevFrame: PlayerFrame };
  const pendingBridge = ref<PendingBridge | null>(null);

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

  // ─── 1) Reduced motion ────────────────────────────────────────────────────

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

  // ─── HUD hide/show signal ─────────────────────────────────────────────────

  const hudShowInProgress = ref(false);
  let hudShowTimeout: number | null = null;

  // ─── TransitionBus ────────────────────────────────────────────────────────
  
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
      if (hudShowTimeout !== null) {
        window.clearTimeout(hudShowTimeout);
        hudShowTimeout = null;
      }
      hudShowInProgress.value = false;
      return;
    }
    if (!wasHidden) return;
    if (effectsDisabled.value || settings.value.hudShowDurationMs <= 0) {
      hudShowInProgress.value = false;
      return;
    }
    hudShowInProgress.value = true;
    hudShowTimeout = window.setTimeout(() => {
      hudShowTimeout = null;
      hudShowInProgress.value = false;
    }, settings.value.hudShowDurationMs);
  });

  // ─── 2) Sprite visibility transitions ────────────────────────────────────

  const {
    onSpriteEnter,
    onSpriteLeave,
    prepareSpriteVisibilityEffects,
    clearSpriteVisibilityTransitions,
  } = useSpriteVisibilityTransitions(
    settings,
    isSceneTransitioning,
    prefersReducedMotion,
    effectsDisabled,
    bus,
  );

  // ─── 3) Scene presentation ────────────────────────────────────────────────

  const {
    displayedBackground,
    displayedSprites,
    previousDisplayedSprites,
    clearTransitionTimeouts,
    applyFrame,
    setCameraTransformElement,
    setBackgroundElement,
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

  // ─── Phase 0 diagnostic state ─────────────────────────────────────────────

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

  // ─── Phase 1: Playable message index ──────────────────────────────────────

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

  // ─── Phase 5: Generation safe-frame lock ─────────────────────────────────

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
      cancelAllEffects();
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

    motionMode.value = 'instant';
    pendingBridge.value = null;
    cancelAllEffects();

    const shouldGoLast = safeId < excludedMessageId;
    pendingFrameTarget.value = shouldGoLast ? { kind: 'last' } : { kind: 'first' };

    updateSettings(draft => {
      draft.preferredMessageId = safeId;
    });
    manualMessageId.value = safeId;
    activeMessageId.value = safeId;

    frameIndex.value = shouldGoLast ? Number.MAX_SAFE_INTEGER : 0;
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

  // ─── Phase FSM ────────────────────────────────────────────────────────────
  
  const blockReveal = computed(
    () => !effectsDisabled.value && hudShowInProgress.value,
  );

  /**
   * Phase FSM coordinates dialogue reveal timing based on animation completion.
   * Uses the TransitionBus created earlier to track in-flight visual transitions.
   */
  const { phase, isBusy: phaseBusy, applyNextFrame, applyFrameIndex } = useFramePhase(
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
  
  // isBusy now reflects phase FSM state (phase === 'scene')
  // This gates transport controls and stage click advance
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

  /**
   * Determines if autoplay can advance to the next frame.
   * 
   * Autoplay waits for:
   * - Scene phase: Visual animations to complete (Req 5.1)
   * - Reveal phase: Dialogue reveal to complete (Req 5.2)
   * - Done phase: Everything complete, ready to advance (Req 5.3)
   * 
   * Also checks:
   * - hasFrames: Must have frames to play
   * - hasNextStep: Must have a next frame to advance to
   * - !isGenerationInProgress: Must not be generating new content
   * 
   * Requirements: 5.1, 5.2, 5.3
   */
  const canAutoAdvanceNow = computed(
    () =>
      hasFrames.value &&
      phase.value === 'done' &&  // Phase-based gating: only advance when everything is complete
      hasNextStep.value &&
      !isGenerationInProgress.value,
  );
  const canSelectPreviousMessage = computed(() => prevPlayableId.value !== null);
  const canSelectNextMessage = computed(() => nextPlayableId.value !== null);

  // ─── Stage geometry + presentation computeds ──────────────────────────────

  function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  const stageWidth = computed(() => Math.round(settings.value.stageHeight * 16 / 9));
  const hudScale = computed(() => clampNumber(settings.value.stageHeight / 480, 0.72, 1.42));

  const stageWrapStyle = computed(() => ({
    height: `${settings.value.stageHeight}px`,
  }));

  const stageStyle = computed(() => ({
    width: `${stageWidth.value}px`,
    height: `${settings.value.stageHeight}px`,
    '--renpy-camera-transition-ms': effectsDisabled.value
      ? '0ms'
      : `${settings.value.cameraTransitionMs}ms`,
    '--stage-height': `${settings.value.stageHeight}px`,
    '--renpy-ui-scale': hudScale.value.toFixed(3),

    '--renpy-shell-pad-x': `0px`,
    '--renpy-shell-pad-bottom': `0px`,
    '--renpy-shell-gap': `0px`,

    '--renpy-dialogue-min-height': `${clampNumber(Math.round(110 * hudScale.value), 80, 160)}px`,
    '--renpy-dialogue-pad-x': `${clampNumber(Math.round(40 * hudScale.value), 20, 60)}px`,
    '--renpy-dialogue-pad-top': `${clampNumber(Math.round(16 * hudScale.value), 12, 24)}px`,
    '--renpy-dialogue-pad-bottom': `${clampNumber(Math.round(16 * hudScale.value), 12, 24)}px`,
    '--renpy-dialogue-gap': `${clampNumber(Math.round(24 * hudScale.value), 16, 40)}px`,

    '--renpy-speaker-col': `${clampNumber(Math.round(140 * hudScale.value), 100, 180)}px`,
    '--renpy-speaker-size': `${clampNumber(Math.round(24 * hudScale.value), 18, 32)}px`,
    '--renpy-text-size': `${clampNumber(Math.round(18 * hudScale.value), 14, 24)}px`,

    '--renpy-rail-width': `${clampNumber(Math.round(214 * hudScale.value), 180, 272)}px`,
    '--renpy-control-gap': `${clampNumber(Math.round(6 * hudScale.value), 4, 10)}px`,
    '--renpy-control-icon': `${clampNumber(Math.round(20 * hudScale.value), 16, 26)}px`,
    '--renpy-control-button-width': `${clampNumber(Math.round(42 * hudScale.value), 34, 52)}px`,
    '--renpy-control-button-height': `${clampNumber(Math.round(34 * hudScale.value), 28, 42)}px`,
    '--renpy-control-row-pad-x': `${clampNumber(Math.round(6 * hudScale.value), 4, 10)}px`,
    '--renpy-control-row-pad-y': `${clampNumber(Math.round(8 * hudScale.value), 6, 12)}px`,
    '--renpy-stepper-button-size': `${clampNumber(Math.round(20 * hudScale.value), 18, 26)}px`,
    '--renpy-stepper-input-width': `${clampNumber(Math.round(34 * hudScale.value), 30, 44)}px`,
    '--renpy-meta-size': `${clampNumber(Math.round(10 * hudScale.value), 9, 12)}px`,
    '--renpy-input-size': `${clampNumber(Math.round(13 * hudScale.value), 11, 17)}px`,

    '--renpy-text-fade-ms': effectsDisabled.value
      ? '0ms'
      : `${settings.value.textFadeMs}ms`,
    '--renpy-speaker-fade-ms': effectsDisabled.value
      ? '0ms'
      : `${settings.value.speakerFadeMs}ms`,
    '--renpy-hud-hide-ms': effectsDisabled.value ? '0ms' : `${settings.value.hudHideDurationMs}ms`,
    '--renpy-hud-show-ms': effectsDisabled.value ? '0ms' : `${settings.value.hudShowDurationMs}ms`,
    '--renpy-hud-hide-drift-ms': effectsDisabled.value
      ? '0ms'
      : `${Math.round(settings.value.hudHideDurationMs * 1.25)}ms`,
    '--renpy-hud-drift-px': `${settings.value.hudHideDriftPx}px`,
  }));

  function resolveActiveCameraPreset(transform?: 'closeup' | 'medium') {
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

  const backgroundStyle = computed(() => {
    const camera = resolveActiveCameraPreset(currentFrame.value?.cameraTransform);
    return {
      transform: `scale(${camera.backgroundScale})`,
      transformOrigin: 'center center',
      transition: 'transform var(--renpy-camera-transition-ms) ease',
    };
  });

  const spriteStyle = computed(() => {
    const camera = resolveActiveCameraPreset(currentFrame.value?.cameraTransform);
    return {
      '--sprite-scale': camera.spriteScale.toString(),
      '--sprite-y': `${camera.spriteY}%`,
    };
  });

  const cameraAnimationClass = computed(
    () => getCameraAnimationClass(currentFrame.value?.cameraAnimations),
  );

  const cameraDiagnosticsLabel = computed(() => {
    const parts = [
      currentFrame.value?.cameraTransform ?? 'default',
      ...(currentFrame.value?.cameraAnimations ?? []),
    ];
    return parts.join(', ');
  });

  // ─── Camera shake tracking ────────────────────────────────────────────────

  /**
   * Camera shake duration in milliseconds (matches CSS animation duration).
   * Defined in renpy-player.scss: .renpy-player__scene-layer--shake
   */
  const CAMERA_SHAKE_DURATION_MS = 450;

  /**
   * Track camera shake animations and register them with the TransitionBus.
   * When a shake animation starts, register a timeout with the bus that will
   * auto-cleanup when the animation completes.
   */
  watch(
    cameraAnimationClass,
    (newClass, oldClass) => {
      console.info('[renpy-player] Camera animation class changed:', { newClass, oldClass, effectsDisabled: effectsDisabled.value });
      
      // Only track when shake class is applied (not when removed)
      if (newClass !== 'renpy-player__scene-layer--shake') {
        return;
      }

      // Skip registration if effects are disabled (reduced motion or instant mode)
      if (effectsDisabled.value) {
        console.info('[renpy-player] Camera shake skipped (effects disabled)');
        return;
      }

      // Skip if this is the same class (no actual change)
      if (newClass === oldClass) {
        console.info('[renpy-player] Camera shake skipped (same class)');
        return;
      }

      // Register cancellation with bus first
      let timeoutHandle: number | undefined;
      const cleanup = bus.register(() => {
        if (timeoutHandle !== undefined) {
          window.clearTimeout(timeoutHandle);
        }
      });

      // Schedule cleanup for when shake completes
      timeoutHandle = window.setTimeout(() => {
        console.info('[renpy-player] Camera shake completed, cleaning up');
        cleanup();
      }, CAMERA_SHAKE_DURATION_MS);

      console.info('[renpy-player] Camera shake registered with TransitionBus', { busCount: bus.count.value });
    },
    { flush: 'post' }
  );

  const renderedSprites = computed(() =>
    (displayedSprites.value ?? []).map(sprite => {
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
    }),
  );

  // ─── Scene presentation helpers ───────────────────────────────────────────

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

  function getSpriteAnchorX(position: 'left' | 'center' | 'right'): number {
    const center = settings.value.spriteCenterX;
    const spacing = settings.value.spriteSideSpacing;
    if (position === 'left') {
      return Math.max(0, center - spacing);
    }
    if (position === 'right') {
      return Math.min(100, center + spacing);
    }
    return center;
  }

  function getSpriteShellStyle(position: 'left' | 'center' | 'right') {
    return {
      left: `${getSpriteAnchorX(position)}%`,
    };
  }

  function getSpriteSwapDuration(sprite: PlayerFrame['sprites'][number]): number {
    if (effectsDisabled.value) {
      return 0;
    }
    const previousSprite = previousDisplayedSprites.value.find(candidate => candidate.id === sprite.id);
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

      // Reset phase to 'scene' when frame changes
      // This handles both frameIndex changes (via applyNextFrame) and message switches
      // Note: applyNextFrame() also calls bus.cancelAll() before changing frameIndex,
      // so in-flight transitions are already cancelled for normal navigation.
      // For message switches, we also need to cancel and reset phase.
      if (nextFrame !== previousFrame) {
        bus.cancelAll();
        phase.value = 'scene';
        clearReveal();
        if (hudShowTimeout !== null) {
          window.clearTimeout(hudShowTimeout);
          hudShowTimeout = null;
        }
        hudShowInProgress.value = false;
      }

      applyFrame(nextFrame, effectivePrev);
    },
    { immediate: true },
  );

  // ─── Sprite / camera animation class helpers ──────────────────────────────

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

  // ─── Actions (selection, transport) ───────────────────────────────────────

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
      if (excludedPlayableMessageIds.value.has(messageId)) {
        return;
      }

      const message = getChatMessages(messageId)[0];
      if (!isMessagePlayable(message)) return;

      const latestPlayable =
        playableMessageIds.value.length > 0
          ? playableMessageIds.value[playableMessageIds.value.length - 1]
          : messageId;
      const targetId = latestPlayable ?? messageId;

      const previousActiveId = activeMessageId.value;

      if (targetId !== previousActiveId) {
        motionMode.value = 'normal';

        const prevFrame = currentFrame.value;
        if (prevFrame) {
          pendingBridge.value = {
            targetKey: cursorKey(targetId, 0),
            prevFrame,
          };
        }
      }

      updateSettings(draft => {
        draft.preferredMessageId = targetId;
      });
      manualMessageId.value = targetId;
      activeMessageId.value = targetId;

      if (targetId !== previousActiveId) {
        frameIndex.value = 0;
      }

      return;
    }

    const preferred = settings.value.preferredMessageId;
    if (preferred != null && messageId > preferred) {
      return;
    }

    fullSync({ rebuildIndex: false });
  }

  /**
   * Handles MESSAGE_SENT events to automatically switch viewport when users send playable messages.
   * 
   * This function mirrors the logic of onMessageReceived() but is specifically designed for
   * user-initiated messages. It respects the followLatestPlayable setting and generation lock
   * exclusions, providing immediate visual feedback when users send Ren'Py commands.
   * 
   * @param messageId - The ID of the message that was sent by the user
   */
  function onMessageSent(messageId: number): void {
    // Early return if auto-follow is disabled
    if (!settings.value.followLatestPlayable) {
      return;
    }

    // Early return if message is excluded (e.g., during generation lock)
    if (excludedPlayableMessageIds.value.has(messageId)) {
      return;
    }

    // Retrieve and validate the message
    const message = getChatMessages(messageId)[0];
    if (!isMessagePlayable(message)) {
      return;
    }

    // Rebuild index to include the newly sent message
    rebuildPlayableIndex();

    // Determine the target message (latest playable)
    const latestPlayable =
      playableMessageIds.value.length > 0
        ? playableMessageIds.value[playableMessageIds.value.length - 1]
        : messageId;
    const targetId = latestPlayable ?? messageId;

    const previousActiveId = activeMessageId.value;

    // Only create bridge and set motion mode if actually changing messages
    if (targetId !== previousActiveId) {
      motionMode.value = 'normal';

      const prevFrame = currentFrame.value;
      if (prevFrame) {
        pendingBridge.value = {
          targetKey: cursorKey(targetId, 0),
          prevFrame,
        };
      }
    }

    // Update all controller state
    updateSettings(draft => {
      draft.preferredMessageId = targetId;
    });
    manualMessageId.value = targetId;
    activeMessageId.value = targetId;

    // Reset to first frame if changing messages
    if (targetId !== previousActiveId) {
      frameIndex.value = 0;
    }
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
   * Handles MESSAGE_UPDATED events that occur during AI generation.
   * 
   * When generation is in progress, MESSAGE_UPDATED events require special handling
   * to confirm the actual generation target and manage playable message exclusions.
   * This function:
   * - Confirms the generation target on first MESSAGE_UPDATED during generation
   * - Updates excluded playable messages if the target differs from prediction
   * - Jumps to a safe frame if the active message becomes the generation target
   * - Returns early if the message is the confirmed generation target
   * - Falls through to standard handling for other messages
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

  /**
   * Unified handler for message modification events.
   * 
   * This function consolidates the logic for MESSAGE_EDITED, MESSAGE_UPDATED, and MESSAGE_SWIPED
   * events to eliminate code duplication. It routes MESSAGE_UPDATED events during generation
   * to special handling logic, while all other cases follow standard message change processing.
   * 
   * @param messageId - The ID of the modified message
   * @param eventType - The type of event that triggered this handler (MESSAGE_EDITED, MESSAGE_UPDATED, or MESSAGE_SWIPED)
   */
  function handleMessageModified(messageId: number, eventType: string): void {
    try {
      console.info(`[renpy-player] Message ${eventType}: ${messageId}`);

      // Special handling for MESSAGE_UPDATED during generation
      if (eventType === 'MESSAGE_UPDATED' && isGenerationInProgress.value) {
        handleMessageUpdatedDuringGeneration(messageId);
        return;
      }

      // Standard handling for all other cases
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

    motionMode.value = 'instant';

    selectMessage(targetId);
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

  function cancelAllEffects() {
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

    motionMode.value = 'instant';
    cancelAllEffects();

    pendingFrameTarget.value = { kind: 'last' };
    updateSettings(draft => {
      draft.preferredMessageId = prevId;
    });
    manualMessageId.value = prevId;
    activeMessageId.value = prevId;

    frameIndex.value = Number.MAX_SAFE_INTEGER;
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

    motionMode.value = 'normal';

    const prevFrame = currentFrame.value;
    if (prevFrame) {
      pendingBridge.value = {
        targetKey: cursorKey(nextId, 0),
        prevFrame,
      };
    }

    updateSettings(draft => {
      draft.preferredMessageId = nextId;
    });
    manualMessageId.value = nextId;
    activeMessageId.value = nextId;
    frameIndex.value = 0;
  }

  /**
   * VN-style phase-based click handler.
   * 
   * Behavior depends on current phase:
   * - Scene phase: Ignore click (visual animations in progress)
   * - Reveal phase: Skip to fully revealed text
   * - Done phase: Advance to next frame if available
   * 
   * Requirements: 2.1, 2.2, 2.3, 2.4
   */
  function onStageClick() {
    if (!hasFrames.value) {
      return;
    }

    // Scene phase: ignore click (Req 2.1)
    if (phase.value === 'scene') {
      console.info('[renpy-player] Stage click ignored (scene phase)');
      return;
    }

    // Reveal phase: skip to fully revealed text (Req 2.2)
    if (phase.value === 'reveal') {
      console.info('[renpy-player] Stage click skipping reveal (reveal phase)');
      skipReveal();
      return;
    }

    // Done phase: advance to next frame if available (Req 2.3, 2.4)
    if (phase.value === 'done') {
      if (canStepForward.value) {
        console.info('[renpy-player] Stage click advancing frame (done phase)');
        stepForwardInternal();
      } else {
        console.info('[renpy-player] Stage click ignored (no next frame, done phase)');
      }
      return;
    }
  }

  // ─── 4) Autoplay ──────────────────────────────────────────────────────────

  const canToggleAutoplay = computed(() => {
    if (isAutoplaying.value) return true;
    return hasFrames.value && !isBusy.value && hasNextStep.value;
  });

  const { isAutoplaying, stopAutoplay, toggleAutoplay } = useAutoplay(
    frames,
    frameIndex,
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

  // ─── Cross-cutting watchers ───────────────────────────────────────────────

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

  // ─── Lifecycle ────────────────────────────────────────────────────────────

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
          console.info(`[renpy-player] Message MESSAGE_SENT: ${messageId}`);
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

    if (hudShowTimeout !== null) {
      window.clearTimeout(hudShowTimeout);
      hudShowTimeout = null;
    }
    hudShowInProgress.value = false;

    // Dispose of TransitionBus to clean up all registrations (Req 6.5, 6.6, 10.4)
    bus.dispose();

    isGenerationInProgress.value = false;
    generationTargetMessageId.value = null;
    excludedPlayableMessageIds.value.clear();
  });

  // ─── Public API (grouped) ─────────────────────────────────────────────────

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
      backgroundStyle,
      spriteStyle,
      cameraAnimationClass,
      cameraDiagnosticsLabel,
      onSpriteEnter,
      onSpriteLeave,
      onSpriteResolved,
      setCameraTransformElement,
      setBackgroundElement,
      trackSpritePositionTransitions,
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

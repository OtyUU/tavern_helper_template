import { ref, computed, watch, onMounted, onScopeDispose, readonly, reactive } from 'vue';
import { storeToRefs } from 'pinia';
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

  // ─── Core derived model ───────────────────────────────────────────────────

  // Cursor coordinate 1/2: which message we're playing.
  // (Cursor coordinate 2/2 is frameIndex.)
  const activeMessageId = ref<number | null>(settings.value.preferredMessageId ?? null);

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
  );

  // ─── 3) Scene presentation ────────────────────────────────────────────────

  const {
    displayedBackground,
    displayedSprites,
    previousDisplayedSprites,
    clearTransitionTimeouts,
    applyFrame,
  } = useScenePresentation(
    settings,
    isSceneTransitioning,
    prepareSpriteVisibilityEffects,
    effectsDisabled,
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
        if (allMessages[i]?.message) {
          history.push(allMessages[i].message);
        }
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
  } = useDialogueReveal(settings, currentFrame, effectsDisabled);

  const dialogueTextFull = computed(
    () => currentFrame.value?.text ?? 'No dialogue on this frame.',
  );

  const autoAdvanceDelayMs = computed(() => settings.value.autoAdvanceDelayMs);

  const hasFrames = computed(() => frames.value.length > 0);
  const isBusy = computed(() => isSceneTransitioning.value);
  const canRestart = computed(() => hasFrames.value && frameIndex.value > 0);
  const canStepBack = computed(() => hasFrames.value && frameIndex.value > 0);
  const canStepForward = computed(
    () => hasFrames.value && frameIndex.value < frames.value.length - 1 && !isBusy.value,
  );
  const canToggleAutoplay = computed(() => frames.value.length > 1 && !isBusy.value);

  const canAutoAdvanceNow = computed(
    () =>
      hasFrames.value &&
      !isSceneTransitioning.value &&
      isFullyRevealed.value &&
      frameIndex.value < frames.value.length - 1,
  );
  const canSelectPreviousMessage = computed(() => (manualMessageId.value ?? 0) > 0);
  const canSelectNextMessage = computed(() => {
    if (manualMessageId.value === null || Number.isNaN(manualMessageId.value)) {
      return false;
    }
    return manualMessageId.value < maxMessageId.value;
  });

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
      applyFrame(nextFrame, previousFrame ?? null);
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

  function fullSync(options: { rebuildIndex?: boolean } = {}) {
    if (options.rebuildIndex !== false) {
      rebuildPlayableIndex();
    }

    historyTrigger.value++;

    const messageId = settings.value.followLatestPlayable
      ? (playableMessageIds.value.length > 0
        ? playableMessageIds.value[playableMessageIds.value.length - 1]
        : null)
      : settings.value.preferredMessageId;

    const previousActiveId = activeMessageId.value;

    settings.value.preferredMessageId = messageId;
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
      const message = getChatMessages(messageId)[0];
      if (isMessagePlayable(message)) {
        settings.value.preferredMessageId = messageId;
        manualMessageId.value = messageId;
        const previousActiveId = activeMessageId.value;
        activeMessageId.value = messageId;
        if (messageId !== previousActiveId) {
          frameIndex.value = 0;
        }
        return;
      }
      return;
    }

    const preferred = settings.value.preferredMessageId;
    if (preferred != null && messageId > preferred) {
      return;
    }

    fullSync({ rebuildIndex: false });
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

  function useLatestPlayable() {
    settings.value.followLatestPlayable = true;
    fullSync();
    frameIndex.value = 0;
  }

  function selectMessage(messageId: number) {
    settings.value.followLatestPlayable = false;
    settings.value.preferredMessageId = messageId;
    fullSync();
    frameIndex.value = 0;
  }

  function applyManualMessageId() {
    if (manualMessageId.value === null || Number.isNaN(manualMessageId.value)) {
      return;
    }
    manualMessageId.value = clampNumber(Math.round(manualMessageId.value), 0, maxMessageId.value);

    motionMode.value = 'instant';

    selectMessage(manualMessageId.value);
  }

  function onManualMessageInput(event: Event) {
    const nextValue = (event.target as HTMLInputElement).value.replace(/[^\d]/g, '');
    manualMessageId.value = nextValue === '' ? null : Number(nextValue);
  }

  function nudgeManualMessageId(delta: number) {
    const baseValue = manualMessageId.value ?? settings.value.preferredMessageId ?? 0;
    manualMessageId.value = clampNumber(Math.round(baseValue) + delta, 0, maxMessageId.value);
    applyManualMessageId();
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

  function jumpToStart() {
    setMotionModeForNav(0);
    cancelAllEffects();
    frameIndex.value = 0;
  }

  function stepBackward() {
    const target = Math.max(0, frameIndex.value - 1);
    setMotionModeForNav(target);
    cancelAllEffects();
    frameIndex.value = target;
  }

  function stepForward() {
    if (isSceneTransitioning.value) {
      return;
    }
    const target = Math.min(frames.value.length - 1, frameIndex.value + 1);
    setMotionModeForNav(target);
    frameIndex.value = target;
  }

  function onStageClick() {
    if (!hasFrames.value || isSceneTransitioning.value) {
      return;
    }

    if (isAutoplaying.value) {
      stopAutoplay();
      return;
    }

    if (isRevealing.value) {
      skipReveal();
      return;
    }

    stepForward();
  }

  // ─── 4) Autoplay ──────────────────────────────────────────────────────────

  const { isAutoplaying, stopAutoplay, toggleAutoplay } = useAutoplay(
    frames,
    frameIndex,
    canAutoAdvanceNow,
    autoAdvanceDelayMs,
    stepForward,
  );

  // ─── Cross-cutting watchers ───────────────────────────────────────────────

  watch(
    frames,
    nextFrames => {
      frameIndex.value = nextFrames.length === 0 ? 0 : Math.min(frameIndex.value, nextFrames.length - 1);
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
      eventOn(tavern_events.MESSAGE_EDITED, (messageId: number) => {
        rebuildPlayableIndex();
        onMessageChanged(messageId);
      }).stop,
      eventOn(tavern_events.MESSAGE_UPDATED, (messageId: number) => {
        rebuildPlayableIndex();
        onMessageChanged(messageId);
      }).stop,
      eventOn(tavern_events.MESSAGE_DELETED, () => {
        fullSync();
      }).stop,
      eventOn(tavern_events.MESSAGE_SWIPED, (messageId: number) => {
        rebuildPlayableIndex();
        onMessageChanged(messageId);
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

    stage: {
      stageWrapStyle,
      stageStyle,
      onStageClick,
    },

    scene: {
      displayedBackground,
      renderedSprites,
      isSceneTransitioning: readonly(isSceneTransitioning),
      sceneFadeStyle,
      backgroundStyle,
      spriteStyle,
      cameraAnimationClass,
      cameraDiagnosticsLabel,
      onSpriteEnter,
      onSpriteLeave,
      onSpriteResolved,
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
      useLatestPlayable,
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

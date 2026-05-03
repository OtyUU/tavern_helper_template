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

  const currentMessage = ref<ChatMessage | null>(null);

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

  const maxMessageId = computed(() => getLastMessageId());
  const characterNaturalHeights = ref<Record<string, number>>({});

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

  function findLatestPlayableMessageId(): number | null {
    const lastId = getLastMessageId();
    if (lastId < 0) return null;
    const allMessages = getChatMessages(`0-${lastId}`);
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const message = allMessages[i];
      if (message && parseScriptFromMessage(message.message).commands.length > 0) {
        return message.message_id;
      }
    }
    return null;
  }

  function fullSync() {
    historyTrigger.value++;
    const messageId = settings.value.followLatestPlayable ? findLatestPlayableMessageId() : settings.value.preferredMessageId;
    settings.value.preferredMessageId = messageId;
    manualMessageId.value = messageId;
    currentMessage.value = messageId === null ? null : getChatMessages(messageId)[0] ?? null;
  }

  function refreshCurrentMessageOnly() {
    const id = currentMessage.value?.message_id;
    if (id != null) {
      currentMessage.value = getChatMessages(id)[0] ?? null;
    }
  }

  function onMessageReceived(messageId: number) {
    if (settings.value.followLatestPlayable) {
      const message = getChatMessages(messageId)[0];
      if (message && parseScriptFromMessage(message.message).commands.length > 0) {
        settings.value.preferredMessageId = messageId;
        manualMessageId.value = messageId;
        currentMessage.value = message;
        return;
      }
      return;
    }

    const preferred = settings.value.preferredMessageId;
    if (preferred != null && messageId > preferred) {
      return;
    }

    fullSync();
  }

  function onMessageChanged(messageId: number) {
    const currentId = currentMessage.value?.message_id;

    if (currentId === messageId) {
      refreshCurrentMessageOnly();
      return;
    }

    if (currentId != null && messageId < currentId) {
      fullSync();
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
    () => [currentMessage.value?.message_id ?? null, currentMessage.value?.message ?? ''],
    (nextSelection, previousSelection) => {
      if (!previousSelection) {
        return;
      }

      const [nextMessageId, nextMessageText] = nextSelection;
      const [previousMessageId, previousMessageText] = previousSelection;
      if (nextMessageId !== previousMessageId || nextMessageText !== previousMessageText) {
        frameIndex.value = 0;
      }
    },
  );

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
      eventOn(tavern_events.CHAT_CHANGED, fullSync).stop,
      eventOn(tavern_events.MESSAGE_RECEIVED, onMessageReceived).stop,
      eventOn(tavern_events.MESSAGE_EDITED, onMessageChanged).stop,
      eventOn(tavern_events.MESSAGE_UPDATED, onMessageChanged).stop,
      eventOn(tavern_events.MESSAGE_DELETED, fullSync).stop,
      eventOn(tavern_events.MESSAGE_SWIPED, onMessageChanged).stop,
      eventOn(tavern_events.MORE_MESSAGES_LOADED, fullSync).stop,
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
    },
  });
}

export type RenpyPlayerController = ReturnType<typeof useRenpyPlayerController>;

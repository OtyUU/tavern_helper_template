import type { Ref } from 'vue';
import { nextTick, ref, watch } from 'vue';
import { normalizeCameraFromFrame } from './camera-utils';
import type { PlayerAsset, PlayerFrame } from './types';

type SpriteVisibilityEffect = 'fade' | 'none';

type SpriteVisibilityTransitionSettings = {
  spriteVisibilityEffect: string;
  spriteEnterMs: number;
  spriteExitMs: number;
};

type ScenePresentationSettings = {
  sceneTransitionMs: number;
};

export function useReducedMotion() {
  const prefersReducedMotion = ref(false);
  let mediaQuery: MediaQueryList | null = null;
  let handleChange: (() => void) | null = null;

  const setup = () => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    mediaQuery = query;
    handleChange = () => {
      prefersReducedMotion.value = query.matches;
    };
    handleChange();
    query.addEventListener('change', handleChange);
  };

  const cleanup = () => {
    if (mediaQuery && handleChange) {
      mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery = null;
    handleChange = null;
  };

  return {
    prefersReducedMotion,
    setup,
    cleanup,
  };
}

export function useSpriteVisibilityTransitions(
  settings: Ref<SpriteVisibilityTransitionSettings>,
  isSceneTransitioning: Ref<boolean>,
  prefersReducedMotion: Ref<boolean>,
  effectsDisabled: Ref<boolean>,
  bus: { register: (cancel: () => void) => () => void },
) {
  const spriteVisibilityAnimations = new WeakMap<Element, Animation>();
  const activeSpriteVisibilityAnimations = new Set<Animation>();
  const pendingEnterEffectById = new Map<string, SpriteVisibilityEffect>();
  const pendingExitEffectById = new Map<string, SpriteVisibilityEffect>();
  const pendingEnterAnimations = new Map<string, () => void>();

  function prepareSpriteVisibilityEffects(
    previousSprites: PlayerFrame['sprites'],
    nextSprites: PlayerFrame['sprites'],
  ) {
    const previous = previousSprites ?? [];
    const next = nextSprites ?? [];
    const previousIds = new Set(previous.map(sprite => sprite.id));
    const nextIds = new Set(next.map(sprite => sprite.id));
    const defaultEffect = settings.value.spriteVisibilityEffect as SpriteVisibilityEffect;

    pendingEnterEffectById.clear();
    pendingExitEffectById.clear();

    nextIds.forEach(id => {
      if (!previousIds.has(id)) {
        pendingEnterEffectById.set(id, defaultEffect);
      }
    });

    previousIds.forEach(id => {
      if (!nextIds.has(id)) {
        pendingExitEffectById.set(id, defaultEffect);
      }
    });
  }

  function cleanupSpriteVisibilityAnimation(el: Element) {
    const animation = spriteVisibilityAnimations.get(el);
    if (animation) {
      activeSpriteVisibilityAnimations.delete(animation);
      animation.cancel();
      spriteVisibilityAnimations.delete(el);
    }
  }

  function resolveSpriteVisibilityEffect(
    spriteId: string | undefined,
    kind: 'enter' | 'exit',
  ): SpriteVisibilityEffect {
    const fallback = settings.value.spriteVisibilityEffect as SpriteVisibilityEffect;
    if (!spriteId) {
      return fallback;
    }

    const sourceMap = kind === 'enter' ? pendingEnterEffectById : pendingExitEffectById;
    const effect = sourceMap.get(spriteId) ?? fallback;
    sourceMap.delete(spriteId);
    return effect;
  }

  function resolveSpriteVisibilityDuration(baseDurationMs: number, effect: SpriteVisibilityEffect): number {
    if (isSceneTransitioning.value || prefersReducedMotion.value || effectsDisabled.value || effect === 'none') {
      return 0;
    }
    return Math.max(0, baseDurationMs);
  }

  function onSpriteEnter(el: Element, done: () => void) {
    const node = el as HTMLElement;
    cleanupSpriteVisibilityAnimation(node);

    let finished = false;
    const complete = () => {
      if (finished) {
        return;
      }
      finished = true;
      const animation = spriteVisibilityAnimations.get(node);
      if (animation) {
        activeSpriteVisibilityAnimations.delete(animation);
        spriteVisibilityAnimations.delete(node);
      }
      node.style.opacity = '';
      done();
    };

    const spriteId = node.dataset.spriteId;
    const effect = resolveSpriteVisibilityEffect(spriteId, 'enter');
    const duration = resolveSpriteVisibilityDuration(settings.value.spriteEnterMs, effect);
    node.style.opacity = '0';

    if (duration <= 0) {
      complete();
      return;
    }

    // Register with TransitionBus immediately to hold the phase
    const cleanupBus = bus.register(() => {
      finished = true;
      const animation = spriteVisibilityAnimations.get(node);
      if (animation) {
        animation.cancel();
      }
      complete();
    });

    const startAnimation = () => {
      if (finished) return;
      try {
        const animation = node.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' },
        );
        spriteVisibilityAnimations.set(node, animation);
        activeSpriteVisibilityAnimations.add(animation);
        
        animation.addEventListener('finish', () => {
          cleanupBus();
          complete();
        }, { once: true });
        animation.addEventListener('cancel', () => {
          cleanupBus();
          complete();
        }, { once: true });
      } catch {
        cleanupBus();
        complete();
      }
    };

    if (spriteId) {
      pendingEnterAnimations.set(spriteId, startAnimation);
      // Fallback in case image resolution fails or takes too long
      window.setTimeout(() => {
        if (pendingEnterAnimations.get(spriteId) === startAnimation) {
          pendingEnterAnimations.delete(spriteId);
          startAnimation();
        }
      }, 3000);
    } else {
      startAnimation();
    }
  }

  function triggerSpriteEnterAnimation(spriteId: string) {
    const start = pendingEnterAnimations.get(spriteId);
    if (start) {
      pendingEnterAnimations.delete(spriteId);
      start();
    }
  }

  function onSpriteLeave(el: Element, done: () => void) {
    const node = el as HTMLElement;
    cleanupSpriteVisibilityAnimation(node);

    let finished = false;
    const complete = () => {
      if (finished) {
        return;
      }
      finished = true;
      const animation = spriteVisibilityAnimations.get(node);
      if (animation) {
        activeSpriteVisibilityAnimations.delete(animation);
        spriteVisibilityAnimations.delete(node);
      }
      done();
    };

    const spriteId = node.dataset.spriteId;
    const effect = resolveSpriteVisibilityEffect(spriteId, 'exit');
    const duration = resolveSpriteVisibilityDuration(settings.value.spriteExitMs, effect);

    if (duration <= 0) {
      complete();
      return;
    }

    // Register immediately to hold the phase
    const cleanupBus = bus.register(() => {
      finished = true;
      const animation = spriteVisibilityAnimations.get(node);
      if (animation) {
        animation.cancel();
      }
      complete();
    });

    // Execute synchronously without requestAnimationFrame (Firefox fix)
    if (finished) return;
    
    try {
      const animation = node.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: 'ease-out', fill: 'forwards' },
      );
      spriteVisibilityAnimations.set(node, animation);
      activeSpriteVisibilityAnimations.add(animation);
      
      animation.addEventListener('finish', () => {
        cleanupBus();
        complete();
      }, { once: true });
      
      animation.addEventListener('cancel', () => {
        cleanupBus();
        complete();
      }, { once: true });
      
    } catch (err) {
      cleanupBus();
      complete();
    }
  }

  function clearSpriteVisibilityTransitions() {
    activeSpriteVisibilityAnimations.forEach(animation => animation.cancel());
    activeSpriteVisibilityAnimations.clear();
    pendingEnterEffectById.clear();
    pendingExitEffectById.clear();
    pendingEnterAnimations.clear();
  }

  return {
    onSpriteEnter,
    onSpriteLeave,
    prepareSpriteVisibilityEffects,
    clearSpriteVisibilityTransitions,
    triggerSpriteEnterAnimation,
  };
}

export function useAutoplay(
  frames: Ref<PlayerFrame[]>,
  canStartAutoplay: Ref<boolean>,
  canAutoAdvanceNow: Ref<boolean>,
  autoAdvanceDelayMs: Ref<number>,
  stepForward: () => void,
  cursorKey: Ref<string>,
) {
  const isAutoplaying = ref(false);
  let pendingTimeout: number | null = null;

  function cancelPending() {
    if (pendingTimeout !== null) {
      window.clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function stopAutoplay() {
    cancelPending();
    isAutoplaying.value = false;
  }

  function scheduleAdvance() {
    cancelPending();
    if (!isAutoplaying.value) return;
    if (!canAutoAdvanceNow.value) return;
    pendingTimeout = window.setTimeout(() => {
      pendingTimeout = null;
      if (!isAutoplaying.value) return;
      stepForward();
      if (isAutoplaying.value && canAutoAdvanceNow.value) scheduleAdvance();
    }, autoAdvanceDelayMs.value);
  }

  function toggleAutoplay() {
    if (isAutoplaying.value) {
      stopAutoplay();
      return;
    }
    if (!canStartAutoplay.value) return;
    isAutoplaying.value = true;
    scheduleAdvance();
  }

  watch(canAutoAdvanceNow, (can) => {
    if (!isAutoplaying.value) return;
    if (can) {
      scheduleAdvance();
    } else {
      cancelPending();
    }
  });

  watch(
    cursorKey,
    () => {
      if (!isAutoplaying.value) return;
      cancelPending();
      if (canAutoAdvanceNow.value) scheduleAdvance();
    },
  );

  watch(
    () => autoAdvanceDelayMs.value,
    () => {
      if (isAutoplaying.value && canAutoAdvanceNow.value) {
        scheduleAdvance();
      }
    },
  );

  watch(
    () => frames.value.length,
    (count) => {
      if (count <= 0) {
        stopAutoplay();
      }
    },
    { immediate: true },
  );

  return {
    isAutoplaying,
    stopAutoplay,
    toggleAutoplay,
  };
}

export function useScenePresentation(
  settings: Ref<ScenePresentationSettings>,
  isSceneTransitioning: Ref<boolean>,
  prepareSpriteVisibilityEffects: (
    previousSprites: PlayerFrame['sprites'],
    nextSprites: PlayerFrame['sprites'],
  ) => void,
  effectsDisabled: Ref<boolean>,
  bus: { register: (cancel: () => void) => () => void },
  prefersReducedMotion: Ref<boolean>,
  cameraTransitionMs: Ref<number>,
) {
  const displayedBackground = ref<PlayerAsset | undefined>();
  const displayedSprites = ref<PlayerFrame['sprites']>([]);
  const displayedCamera = ref<PlayerFrame['camera']>(undefined);
  const displayedCameraAnimations = ref<PlayerFrame['cameraAnimations']>(undefined);
  const previousDisplayedSprites = ref<PlayerFrame['sprites']>([]);
  const transitionTimeouts = ref<number[]>([]);
  const backgroundCameraElement = ref<HTMLElement | null>(null);
  const spriteCameraElement = ref<HTMLElement | null>(null);
  const prevBackgroundTransform = ref('none');
  const prevSpriteTransform = ref('none');
  const activeCameraAnimationTrackers = new WeakMap<HTMLElement, Map<string, () => void>>();
  const sharedTransformStartTime = ref<number | null>(null);

  const prevSpriteMotionTransformById = new Map<string, string>();
  const activeSpriteMotionEls = new Set<HTMLElement>();

  function syncPrevSpriteMotionTransforms(spriteMotionEls: HTMLElement[]): void {
    prevSpriteMotionTransformById.clear();
    for (const el of spriteMotionEls) {
      const id = el?.dataset.spriteId;
      if (!id) continue;
      prevSpriteMotionTransformById.set(id, el.style.transform || 'none');
    }
  }

  watch(displayedSprites, (_nextSprites, previousSprites) => {
    previousDisplayedSprites.value = previousSprites ?? [];
  });

  watch([() => prefersReducedMotion.value, () => effectsDisabled.value], ([reduced, disabled]) => {
    if (!reduced && !disabled) return;

    if (backgroundCameraElement.value) {
      activeCameraAnimationTrackers.get(backgroundCameraElement.value)?.get('transform')?.();
    }

    if (spriteCameraElement.value) {
      activeCameraAnimationTrackers.get(spriteCameraElement.value)?.get('transform')?.();
    }

    for (const el of activeSpriteMotionEls) {
      activeCameraAnimationTrackers.get(el)?.get('transform')?.();
      el.classList.remove('renpy-player__sprite-motion--animating');
    }
    activeSpriteMotionEls.clear();
  });

  function clearTransitionTimeouts() {
    transitionTimeouts.value.forEach(timeoutId => window.clearTimeout(timeoutId));
    transitionTimeouts.value = [];
  }

  function updateDisplayedSprites(nextSprites: PlayerFrame['sprites']) {
    const previousSprites = displayedSprites.value ?? [];
    const next = nextSprites ?? [];
    prepareSpriteVisibilityEffects(previousSprites, next);
    displayedSprites.value = next;
  }

  function resetDisplayedState() {
    displayedBackground.value = undefined;
    displayedCamera.value = { preset: 'default' };
    displayedCameraAnimations.value = undefined;
    updateDisplayedSprites([]);
    isSceneTransitioning.value = false;
  }

  function applyDisplayedFrame(frame: PlayerFrame) {
    const nextBg = frame.background;
    const currBg = displayedBackground.value;
    const bgChanged = 
      nextBg?.description !== currBg?.description ||
      nextBg?.candidates?.join('|') !== currBg?.candidates?.join('|');

    if (bgChanged) {
      displayedBackground.value = nextBg;
    }

    const nextCam = normalizeCameraFromFrame(frame);
    const currCam = displayedCamera.value;
    const camChanged = 
      nextCam.preset !== currCam?.preset ||
      nextCam.panXPct !== currCam?.panXPct ||
      nextCam.panYPct !== currCam?.panYPct;
    
    if (camChanged) {
      displayedCamera.value = nextCam;
    }

    displayedCameraAnimations.value = frame.cameraAnimations;
    updateDisplayedSprites(frame.sprites ?? []);
    isSceneTransitioning.value = false;
  }

  function applyFrame(next: PlayerFrame | null, prev: PlayerFrame | null): void {
    clearTransitionTimeouts();


    if (!next) {
      resetDisplayedState();
      return;
    }

    if (!prev || next.index === prev.index) {
      applyDisplayedFrame(next);
      trackCameraTransformTransition({ syncOnly: true });
      return;
    }

    if (effectsDisabled.value) {
      applyDisplayedFrame(next);
      trackCameraTransformTransition({ syncOnly: true });
      return;
    }

    if (next.isNewScene) {
      if (settings.value.sceneTransitionMs <= 0) {
        applyDisplayedFrame(next);
        trackCameraTransformTransition({ syncOnly: true });
        return;
      }

      const halfDuration = Math.floor(settings.value.sceneTransitionMs / 2);
      const fullDuration = settings.value.sceneTransitionMs;
      isSceneTransitioning.value = true;
      displayedCameraAnimations.value = undefined;

      const midpointHandle = window.setTimeout(() => {
        displayedBackground.value = next.background;
        displayedCamera.value = normalizeCameraFromFrame(next);
        updateDisplayedSprites([]);
        trackCameraTransformTransition({ syncOnly: true });
      }, halfDuration);

      let unregister: (() => void) | null = null;
      const finalHandle = window.setTimeout(() => {
        updateDisplayedSprites(next.sprites ?? []);
        displayedCameraAnimations.value = next.cameraAnimations;
        isSceneTransitioning.value = false;
        trackCameraTransformTransition({ syncOnly: true });
        transitionTimeouts.value = [];
        unregister?.();
        unregister = null;
      }, fullDuration);

      transitionTimeouts.value = [midpointHandle, finalHandle];
      
      unregister = bus.register(() => {
        window.clearTimeout(midpointHandle);
        window.clearTimeout(finalHandle);
        transitionTimeouts.value = [];
        applyDisplayedFrame(next);
        trackCameraTransformTransition({ syncOnly: true });
        isSceneTransitioning.value = false;
      });
      
      return;
    }

    applyDisplayedFrame(next);
    
    // For standard frames, attempt to animate the camera if it changed.
    // The tracker will automatically fall back to sync-only if effects are disabled.
    trackCameraTransformTransition();
  }

  const isFirefox =
    typeof navigator !== 'undefined' && /Firefox\/\d+/i.test(navigator.userAgent);

  const CAMERA_TRANSFORM_EASING = isFirefox
    ? 'cubic-bezier(0.15, 0.05, 0.85, 0.95)'
    : 'ease';

  function trackCameraTransformTransition(options: { syncOnly?: boolean } = {}): void {
    const bgEl = backgroundCameraElement.value;
    const spriteEl = spriteCameraElement.value;

    const skipAnimation = 
      options.syncOnly || 
      effectsDisabled.value || 
      prefersReducedMotion.value || 
      cameraTransitionMs.value <= 0;

    if (skipAnimation) {
      nextTick(() => {
        const toBg = backgroundCameraElement.value?.style.transform || 'none';
        const toSprite = spriteCameraElement.value?.style.transform || 'none';
        
        if (backgroundCameraElement.value) prevBackgroundTransform.value = toBg;
        if (spriteCameraElement.value) prevSpriteTransform.value = toSprite;
      });
      return;
    }

    const fromBg = bgEl ? prevBackgroundTransform.value : null;
    const fromSprite = spriteEl ? prevSpriteTransform.value : null;

    if (fromBg === null && fromSprite === null) return;

    let finished = false;
    const unlockPrelim = bus.register(() => { finished = true; });

    nextTick(() => {
      if (finished) {
        unlockPrelim();
        return;
      }

      if (effectsDisabled.value || prefersReducedMotion.value || cameraTransitionMs.value <= 0) {
        unlockPrelim();
        return;
      }

      const bgEl2 = backgroundCameraElement.value;
      const spriteEl2 = spriteCameraElement.value;

      const sharedStartTime =
        (document.timeline?.currentTime ?? null) as number | null;

      sharedTransformStartTime.value = sharedStartTime;
      queueMicrotask(() => {
        sharedTransformStartTime.value = null;
      });

      const toBg = bgEl2?.style.transform || 'none';
      const toSprite = spriteEl2?.style.transform || 'none';

      if (bgEl2) prevBackgroundTransform.value = toBg;
      if (spriteEl2) prevSpriteTransform.value = toSprite;

      const animateLayer = (
        el: HTMLElement,
        from: string,
        to: string,
      ) => {
        if (from === to) return;

        let waapiCleanup: (() => void) | null = null;

        const cancel = () => { waapiCleanup?.(); };
        const deregister = bus.register(cancel);

        waapiCleanup = animateCameraLayerWAAPI(el, from, to, cameraTransitionMs.value, () => {
          deregister();
        },
        sharedStartTime,
        CAMERA_TRANSFORM_EASING,
      );
      };

      if (bgEl2 && fromBg !== null && toBg !== null) {
        animateLayer(bgEl2, fromBg, toBg);
      }

      if (spriteEl2 && fromSprite !== null && toSprite !== null) {
        animateLayer(spriteEl2, fromSprite, toSprite);
      }

      unlockPrelim();
    });
  }
  
  /**
   * Animate a camera layer element from one CSS transform to another using the
   * Web Animations API (WAAPI).
   *
   * Preconditions:
   *   - `element` is mounted in the DOM.
   *   - `fromTransform` and `toTransform` are valid CSS `transform` values
   *     (e.g. `"translate(10px, 20px) scale(1.5)"`).
   *   - `durationMs` > 0 (caller should short-circuit for ≤ 0).
   *
   * Postconditions:
   *   - If `fromTransform === toTransform` or `durationMs <= 0`, `onDone` is
   *     called synchronously and no animation is created.
   *   - Otherwise a WAAPI animation is created with `ease` easing and
     *     `fill: 'both'` so the animation holds its from/to state around its
     *     active phase (cleanup always `cancel()`s, reverting to Vue's inline
     *     `style.transform`).
   *   - Any previous animation tracked on the same element for `'transform'` is
   *     cancelled before the new one starts.
   *   - `onDone` is called exactly once: on finish, cancel, early-return, or
   *     fallback timeout.
   *   - Returns a cleanup/cancel function for the caller to register with the
   *     TransitionBus.
   */
  function animateCameraLayerWAAPI(
    element: HTMLElement,
    fromTransform: string,
    toTransform: string,
    durationMs: number,
    onDone?: () => void,
    explicitStartTime?: number | null,
    easing: string = 'ease',
  ): () => void {
    if (durationMs <= 0) {
      onDone?.();
      return () => {};
    }

    if (fromTransform === toTransform) {
      onDone?.();
      return () => {};
    }

    let perProp = activeCameraAnimationTrackers.get(element);
    if (!perProp) {
      perProp = new Map<string, () => void>();
      activeCameraAnimationTrackers.set(element, perProp);
    }

    perProp.get('transform')?.();

    const animation = element.animate(
      [{ transform: fromTransform }, { transform: toTransform }],
      { duration: durationMs, easing, fill: 'both' },
    );

    if (explicitStartTime != null) {
      try {
        animation.pause();
        animation.startTime = explicitStartTime;
        animation.currentTime = 0;
        animation.play();
      } catch {
        // Firefox may reject startTime assignment; keep the animation running.
      }
    }

    let finished = false;
    let fallbackHandle: number | null = null;

    const cleanup = () => {
      if (finished) return;
      finished = true;

      if (fallbackHandle !== null) {
        window.clearTimeout(fallbackHandle);
        fallbackHandle = null;
      }

      animation.cancel();

      const current = perProp?.get('transform');
      if (current === cleanup) {
        perProp?.delete('transform');
        if (perProp && perProp.size === 0) {
          activeCameraAnimationTrackers.delete(element);
        }
      }

      onDone?.();
    };

    perProp.set('transform', cleanup);

    animation.addEventListener('finish', cleanup);
    animation.addEventListener('cancel', cleanup);

    fallbackHandle = window.setTimeout(cleanup, durationMs + 50);

    return cleanup;
  }

  function setBackgroundCameraElement(element: HTMLElement | null): void {
    backgroundCameraElement.value = element;
  }

  function setSpriteCameraElement(element: HTMLElement | null): void {
    spriteCameraElement.value = element;
  }
  
  function trackSpritePositionTransitions(spriteMotionEls: HTMLElement[]): void {
    if (!spriteMotionEls || spriteMotionEls.length === 0) return;

    const durationMs =
      effectsDisabled.value ||
      prefersReducedMotion.value ||
      isSceneTransitioning.value ||
      cameraTransitionMs.value <= 0
        ? 0
        : cameraTransitionMs.value;

    if (durationMs <= 0 || prevSpriteMotionTransformById.size === 0) {
      syncPrevSpriteMotionTransforms(spriteMotionEls);
      return;
    }

    for (const el of spriteMotionEls) {
      const id = el?.dataset.spriteId;
      if (!id) continue;

      const to = el.style.transform || 'none';
      const from = prevSpriteMotionTransformById.get(id) ?? to;

      if (from === to) continue;

      el.classList.add('renpy-player__sprite-motion--animating');
      activeSpriteMotionEls.add(el);

      let deregister = () => {};
      const onDone = () => {
        deregister();
        el.classList.remove('renpy-player__sprite-motion--animating');
        activeSpriteMotionEls.delete(el);
      };

      const cleanup = animateCameraLayerWAAPI(
        el,
        from,
        to,
        durationMs,
        onDone,
        sharedTransformStartTime.value,
        CAMERA_TRANSFORM_EASING,
      );
      deregister = bus.register(cleanup);
    }

    syncPrevSpriteMotionTransforms(spriteMotionEls);
  }

  return {
    displayedBackground,
    displayedSprites,
    displayedCamera,
    displayedCameraAnimations,
    previousDisplayedSprites,
    clearTransitionTimeouts,
    applyFrame,
    setBackgroundCameraElement,
    setSpriteCameraElement,
    trackSpritePositionTransitions,
  };
}

const SENTENCE_ENDERS = new Set(['.', '!', '?', '…', '。', '！', '？']);
const CLAUSE_MARKS = new Set([',', ';', ':', '、', '；', '：', '—']);

type DialogueRevealSettings = {
  textSpeedMs: number;
  textFadeMs: number;
  sentencePauseMs: number;
  commaPauseMs: number;
  speakerFadeMs: number;
};

function splitToGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
    return Array.from(
      new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text),
      s => s.segment,
    );
  }
  return [...text];
}

/**
 * Typewriter-style dialogue reveal. Called by phase FSM via `beginReveal()`.
 */
export function useDialogueReveal(
  settings: Ref<DialogueRevealSettings>,
  currentFrame: Ref<PlayerFrame | null>,
  effectsDisabled: Ref<boolean>,
) {
  const graphemes = ref<string[]>([]);
  const revealedCharCount = ref(0);
  const displayedSpeaker = ref('');
  const speakerRevealed = ref(true);
  const isRevealing = ref(false);
  const isFullyRevealed = ref(true);
  let revealGeneration = 0;
  let trackedPrevFrame: PlayerFrame | null = null;

  function scheduleFadeTail(gen: number) {
    if (settings.value.textFadeMs <= 0 || effectsDisabled.value) {
      isFullyRevealed.value = true;
      return;
    }
    isFullyRevealed.value = false;
    window.setTimeout(() => {
      if (revealGeneration === gen) {
        isFullyRevealed.value = true;
      }
    }, settings.value.textFadeMs);
  }

  function skipReveal() {
    revealGeneration++;
    if (graphemes.value.length === 0) {
      return;
    }
    const gen = revealGeneration;
    revealedCharCount.value = graphemes.value.length;
    const speaker = currentFrame.value?.speaker?.trim() ?? '';
    displayedSpeaker.value = speaker;
    speakerRevealed.value = speaker !== '';
    isRevealing.value = false;
    scheduleFadeTail(gen);
  }

  function clearReveal() {
    revealGeneration++;
    graphemes.value = [];
    revealedCharCount.value = 0;
    displayedSpeaker.value = '';
    speakerRevealed.value = false;
    isRevealing.value = false;
    isFullyRevealed.value = true;
  }

  function startReveal(
    text: string,
    prevSpeaker: string | undefined,
    currentSpeaker: string | undefined,
  ) {
    revealGeneration++;
    const gen = revealGeneration;
    const chars = splitToGraphemes(text);
    graphemes.value = chars;

    const speaker = currentSpeaker?.trim() ?? '';
    const prevSpk = prevSpeaker?.trim() ?? '';

    if (effectsDisabled.value) {
      revealedCharCount.value = chars.length;
      displayedSpeaker.value = speaker;
      speakerRevealed.value = speaker !== '';
      isRevealing.value = false;
      scheduleFadeTail(gen);
      return;
    }

    const prevIsEmpty = prevSpk === '';
    const nextIsEmpty = speaker === '';
    const hasSpeakerGone     = !prevIsEmpty && nextIsEmpty;
    const hasSpeakerAppeared = prevIsEmpty  && !nextIsEmpty;

    revealedCharCount.value = 0;
    isRevealing.value = true;
    isFullyRevealed.value = false;

    if (hasSpeakerGone) {
      speakerRevealed.value = false;
      window.setTimeout(() => {
        if (revealGeneration === gen) displayedSpeaker.value = '';
      }, settings.value.speakerFadeMs);
    } else if (hasSpeakerAppeared) {
      displayedSpeaker.value = speaker;
      speakerRevealed.value = false;
      window.setTimeout(() => {
        if (revealGeneration === gen) speakerRevealed.value = true;
      }, settings.value.speakerFadeMs);
    } else {
      displayedSpeaker.value = speaker;
      speakerRevealed.value = speaker !== '';
    }

    if (settings.value.textSpeedMs <= 0) {
      window.setTimeout(() => {
        if (revealGeneration !== gen) return;
        revealedCharCount.value = chars.length;
        isRevealing.value = false;
        scheduleFadeTail(gen);
      }, 0);
      return;
    }

    let cumulativeDelay = 0;
    for (let i = 0; i < chars.length; i++) {
      const charIdx = i;
      const charDelay = cumulativeDelay;
      window.setTimeout(() => {
        if (revealGeneration !== gen) return;
        revealedCharCount.value = charIdx + 1;
        if (charIdx === chars.length - 1) {
          isRevealing.value = false;
          scheduleFadeTail(gen);
        }
      }, charDelay);

      let pause = 0;
      const nextChar = chars[i + 1];
      const nextIsPunct = nextChar !== undefined
        && (SENTENCE_ENDERS.has(nextChar) || CLAUSE_MARKS.has(nextChar));

      if (!nextIsPunct) {
        if (SENTENCE_ENDERS.has(chars[i])) {
          pause = settings.value.sentencePauseMs;
        } else if (CLAUSE_MARKS.has(chars[i])) {
          pause = settings.value.commaPauseMs;
        }
      }
      cumulativeDelay += settings.value.textSpeedMs + pause;
    }
  }

  /**
   * Begin typewriter reveal for the current frame.
   * Called by phase FSM when transitioning to 'reveal' phase.
   * Increments revealGeneration to cancel any previous in-flight reveals.
   */
  function beginReveal() {
    const nextFrame = currentFrame.value;
    const prevFrame = trackedPrevFrame;
    trackedPrevFrame = nextFrame ?? null;

    if (!nextFrame || !nextFrame.text) {
      revealGeneration++;
      graphemes.value = [];
      revealedCharCount.value = 0;
      displayedSpeaker.value = '';
      speakerRevealed.value = true;
      isRevealing.value = false;
      isFullyRevealed.value = true;

      return;
    }

    startReveal(nextFrame.text, prevFrame?.speaker, nextFrame.speaker);
  }

  watch(effectsDisabled, (disabled) => {
    if (disabled && (isRevealing.value || !isFullyRevealed.value)) {
      revealGeneration++;
      revealedCharCount.value = graphemes.value.length;
      speakerRevealed.value = displayedSpeaker.value !== '';
      isRevealing.value = false;
      isFullyRevealed.value = true;
    }
  });

  return {
    graphemes,
    revealedCharCount,
    displayedSpeaker,
    speakerRevealed,
    isRevealing,
    isFullyRevealed,
    skipReveal,
    clearReveal,
    beginReveal,
  };
}

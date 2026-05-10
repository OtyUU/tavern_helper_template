import type { Ref } from 'vue';
import { ref, watch, nextTick } from 'vue';
import type { PlayerAsset, PlayerFrame } from './types';
import { normalizeCameraFromFrame } from './camera-utils';

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

    requestAnimationFrame(() => {
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
      } catch {
        cleanupBus();
        complete();
      }
    });
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
  const activeCssTransitionTrackers = new WeakMap<HTMLElement, Map<string, () => void>>();

  watch(displayedSprites, (_nextSprites, previousSprites) => {
    previousDisplayedSprites.value = previousSprites ?? [];
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
    displayedBackground.value = frame.background;
    displayedCamera.value = normalizeCameraFromFrame(frame);
    displayedCameraAnimations.value = frame.cameraAnimations;
    updateDisplayedSprites(frame.sprites ?? []);
    isSceneTransitioning.value = false;
  }

  function applyFrame(next: PlayerFrame | null, prev: PlayerFrame | null): void {
    clearTransitionTimeouts();

    // Lock the bus temporarily to prevent the phase FSM from advancing before Vue updates the DOM.
    // TransitionGroup hooks (onSpriteEnter/Leave) fire synchronously during DOM patch.
    // By the time nextTick executes, those hooks will have registered their actual animations.
    const unlockDomUpdate = bus.register(() => {});
    nextTick(() => {
      unlockDomUpdate();
    });

    if (!next) {
      resetDisplayedState();
      return;
    }

    if (!prev || next.index === prev.index) {
      applyDisplayedFrame(next);
      return;
    }

    if (effectsDisabled.value) {
      applyDisplayedFrame(next);
      return;
    }

    if (next.isNewScene) {
      if (settings.value.sceneTransitionMs <= 0) {
        applyDisplayedFrame(next);
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
      }, halfDuration);

      let unregister: (() => void) | null = null;
      const finalHandle = window.setTimeout(() => {
        updateDisplayedSprites(next.sprites ?? []);
        displayedCameraAnimations.value = next.cameraAnimations;
        isSceneTransitioning.value = false;
        transitionTimeouts.value = [];
        unregister?.();
        unregister = null;
      }, fullDuration);

      transitionTimeouts.value = [midpointHandle, finalHandle];
      
      unregister = bus.register(() => {
        window.clearTimeout(midpointHandle);
        window.clearTimeout(finalHandle);
        transitionTimeouts.value = [];
        isSceneTransitioning.value = false;
      });
      
      return;
    }

    applyDisplayedFrame(next);
    
    // Track camera transform CSS transitions
    trackCameraTransformTransition(next, prev);
  }
  
  /** Track camera transform CSS transitions via TransitionBus. */
  function trackCameraTransformTransition(next: PlayerFrame, prev: PlayerFrame): void {
    // Skip if effects disabled or reduced motion
    if (effectsDisabled.value || prefersReducedMotion.value) {
      return;
    }
    
    const nextPreset = normalizeCameraFromFrame(next).preset;
    const prevPreset = normalizeCameraFromFrame(prev).preset;
    if (nextPreset === prevPreset) {
      return;
    }
    
    if (cameraTransitionMs.value <= 0) {
      return;
    }
    
    if (backgroundCameraElement.value) {
      trackCssTransition(
        backgroundCameraElement.value,
        'transform',
        cameraTransitionMs.value,
        'camera transform (bg layer)',
      );
    }

    if (spriteCameraElement.value) {
      trackCssTransition(
        spriteCameraElement.value,
        'transform',
        cameraTransitionMs.value,
        'camera transform (sprite layer)',
      );
    }
  }
  
  function trackCssTransition(
    element: HTMLElement,
    propertyName: string,
    durationMs: number,
    _label?: string,
  ): void {
    if (durationMs <= 0) {
      return;
    }

    let perProp = activeCssTransitionTrackers.get(element);
    if (!perProp) {
      perProp = new Map<string, () => void>();
      activeCssTransitionTrackers.set(element, perProp);
    }

    perProp.get(propertyName)?.();

    let finished = false;
    let unregister: (() => void) | null = null;
    let fallbackHandle: number | null = null;

    const complete = () => {
      if (finished) return;
      finished = true;

      if (fallbackHandle !== null) {
        window.clearTimeout(fallbackHandle);
        fallbackHandle = null;
      }

      if (unregister) {
        unregister();
        unregister = null;
      }

      element.removeEventListener('transitionend', onTransitionEnd);
      element.removeEventListener('transitioncancel', onTransitionCancel);

      const current = perProp?.get(propertyName);
      if (current === complete) {
        perProp?.delete(propertyName);
        if (perProp && perProp.size === 0) {
          activeCssTransitionTrackers.delete(element);
        }
      }
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== element) return;
      if (event.propertyName !== propertyName) return;
      complete();
    };

    const onTransitionCancel = (event: TransitionEvent) => {
      if (event.target !== element) return;
      if (event.propertyName !== propertyName) return;
      complete();
    };

    perProp.set(propertyName, complete);

    unregister = bus.register(() => {
      complete();
    });

    element.addEventListener('transitionend', onTransitionEnd, { once: false });
    element.addEventListener('transitioncancel', onTransitionCancel, { once: false });

    const fallbackMs = durationMs + 50;
    fallbackHandle = window.setTimeout(() => {
      complete();
    }, fallbackMs);
  }
  
  function setBackgroundCameraElement(element: HTMLElement | null): void {
    backgroundCameraElement.value = element;
  }

  function setSpriteCameraElement(element: HTMLElement | null): void {
    spriteCameraElement.value = element;
  }
  
  /** Track CSS left transitions on sprites whose position changed. */
  function trackSpritePositionTransitions(spriteShells: HTMLElement[]): void {
    // Skip if effects disabled or reduced motion
    if (effectsDisabled.value || prefersReducedMotion.value) {
      return;
    }
    
    if (cameraTransitionMs.value <= 0) {
      return;
    }
    
    // Get current sprite positions to compare
    const currentSprites = displayedSprites.value ?? [];
    const previousSprites = previousDisplayedSprites.value ?? [];
    
    // Only track sprites that exist in both current and previous (position changes, not enter/leave)
    const spritesToTrack = currentSprites.filter(current => {
      const previous = previousSprites.find(p => p.id === current.id);
      // Only track if sprite existed before AND position changed
      return previous && previous.position !== current.position;
    });
    
    if (spritesToTrack.length === 0) {
      return;
    }
    
    spritesToTrack.forEach(sprite => {
      const shell = spriteShells.find(el => el?.dataset.spriteId === sprite.id);
      if (!shell) {
        return;
      }
      
      trackCssTransition(shell, 'transform', cameraTransitionMs.value, `sprite transform (${sprite.id})`);
    });
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

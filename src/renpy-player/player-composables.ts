import { ref, watch } from 'vue';
import type { Ref } from 'vue';
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
) {
  const spriteVisibilityAnimations = new WeakMap<Element, Animation>();
  const activeSpriteVisibilityAnimations = new Set<Animation>();
  const pendingEnterEffectById = new Map<string, SpriteVisibilityEffect>();
  const pendingExitEffectById = new Map<string, SpriteVisibilityEffect>();

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

    try {
      const animation = node.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: 'ease-out', fill: 'forwards' },
      );
      spriteVisibilityAnimations.set(node, animation);
      activeSpriteVisibilityAnimations.add(animation);
      animation.addEventListener('finish', complete, { once: true });
      animation.addEventListener('cancel', complete, { once: true });
    } catch {
      complete();
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

    try {
      const animation = node.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: 'ease-out', fill: 'forwards' },
      );
      spriteVisibilityAnimations.set(node, animation);
      activeSpriteVisibilityAnimations.add(animation);
      animation.addEventListener('finish', complete, { once: true });
      animation.addEventListener('cancel', complete, { once: true });
    } catch {
      complete();
    }
  }

  function clearSpriteVisibilityTransitions() {
    activeSpriteVisibilityAnimations.forEach(animation => animation.cancel());
    activeSpriteVisibilityAnimations.clear();
    pendingEnterEffectById.clear();
    pendingExitEffectById.clear();
  }

  return {
    onSpriteEnter,
    onSpriteLeave,
    prepareSpriteVisibilityEffects,
    clearSpriteVisibilityTransitions,
  };
}

export function useAutoplay(
  frames: Ref<PlayerFrame[]>,
  frameIndex: Ref<number>,
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
) {
  const displayedBackground = ref<PlayerAsset | undefined>();
  const displayedSprites = ref<PlayerFrame['sprites']>([]);
  const previousDisplayedSprites = ref<PlayerFrame['sprites']>([]);
  const transitionTimeouts = ref<number[]>([]);

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
    updateDisplayedSprites([]);
    isSceneTransitioning.value = false;
  }

  function applyDisplayedFrame(frame: PlayerFrame) {
    displayedBackground.value = frame.background;
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

      const midpointHandle = window.setTimeout(() => {
        displayedBackground.value = next.background;
        updateDisplayedSprites([]);
      }, halfDuration);

      const finalHandle = window.setTimeout(() => {
        updateDisplayedSprites(next.sprites ?? []);
        isSceneTransitioning.value = false;
        transitionTimeouts.value = [];
      }, fullDuration);

      transitionTimeouts.value = [midpointHandle, finalHandle];
      return;
    }

    applyDisplayedFrame(next);
  }

  return {
    displayedBackground,
    displayedSprites,
    previousDisplayedSprites,
    clearTransitionTimeouts,
    applyFrame,
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

  let trackedPrevFrame: PlayerFrame | null = null;

  watch(
    () => currentFrame.value,
    (nextFrame, _prev) => {
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
    },
    { immediate: true },
  );

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
  };
}

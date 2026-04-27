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
    if (isSceneTransitioning.value || prefersReducedMotion.value || effect === 'none') {
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
  isSceneTransitioning: Ref<boolean>,
  autoPlayDelayMs: Ref<number>,
  stepForward: () => void,
) {
  const isAutoplaying = ref(false);
  const autoplayHandle = ref<number | null>(null);

  function stopAutoplay() {
    if (autoplayHandle.value !== null) {
      window.clearInterval(autoplayHandle.value);
      autoplayHandle.value = null;
    }
    isAutoplaying.value = false;
  }

  function toggleAutoplay() {
    if (isSceneTransitioning.value) {
      return;
    }
    if (isAutoplaying.value) {
      stopAutoplay();
      return;
    }
    if (frames.value.length <= 1) {
      return;
    }

    isAutoplaying.value = true;
    autoplayHandle.value = window.setInterval(() => {
      if (isSceneTransitioning.value) {
        return;
      }
      if (frameIndex.value >= frames.value.length - 1) {
        stopAutoplay();
        return;
      }
      stepForward();
    }, autoPlayDelayMs.value);
  }

  watch(
    () => autoPlayDelayMs.value,
    () => {
      if (isAutoplaying.value) {
        stopAutoplay();
        toggleAutoplay();
      }
    },
  );

  watch(
    () => frames.value.length,
    frameCount => {
      if (frameCount <= 1) {
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
  prepareSpriteVisibilityEffects: (
    previousSprites: PlayerFrame['sprites'],
    nextSprites: PlayerFrame['sprites'],
  ) => void,
) {
  const displayedBackground = ref<PlayerAsset | undefined>();
  const displayedSprites = ref<PlayerFrame['sprites']>([]);
  const previousDisplayedSprites = ref<PlayerFrame['sprites']>([]);
  const isSceneTransitioning = ref(false);
  const transitionTimeouts = ref<number[]>([]);

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
    isSceneTransitioning,
    clearTransitionTimeouts,
    applyFrame,
  };
}

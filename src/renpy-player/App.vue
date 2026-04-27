<template>
  <section class="renpy-player">
    <!-- Wrapper: full width, fixed height (stageHeight), centers the 16:9 stage and shows letter/pillar-box bars -->
    <div class="renpy-player__stage-wrap" :style="stageWrapStyle">
      <!-- Fixed ~16:9 viewport: height = stageHeight, width = round(stageHeight*16/9) -->
      <div class="renpy-player__stage" :style="stageStyle">
        <div class="renpy-player__scene-layer" :class="cameraAnimationClass">
          <div
            v-if="isSceneTransitioning"
            class="renpy-player__scene-fade"
            :style="sceneFadeStyle"
          ></div>

          <!-- Background covers the viewport (object-fit: cover) and is additionally scaled by camera presets -->
          <SmartImage
            v-if="displayedBackground?.candidates?.length"
            class="renpy-player__background"
            :style="backgroundStyle"
            :candidates="displayedBackground.candidates"
            :alt="displayedBackground.description"
          />

          <div class="renpy-player__gradient"></div>

          <TransitionGroup
            tag="div"
            class="renpy-player__sprite-layer"
            :css="false"
            @enter="onSpriteEnter"
            @leave="onSpriteLeave"
          >
            <div
              v-for="sprite in renderedSprites"
              :key="sprite.renderKey"
              class="renpy-player__sprite-shell"
              :data-sprite-id="sprite.id"
              :style="sprite.shellStyle"
            >
              <SmartImage
                class="renpy-player__sprite"
                :class="sprite.animationClass"
                :style="spriteStyle"
                :candidates="sprite.asset?.candidates ?? []"
                :alt="sprite.asset?.description ?? sprite.id"
                :swap-duration-ms="sprite.swapDurationMs"
              />
            </div>
          </TransitionGroup>
        </div>

        <div class="renpy-player__viewport">
          <div v-if="!currentFrame" class="renpy-player__empty-state">
            <p>Select a chat message containing a Ren'Py-like block to preview it here.</p>
            <p>
              The parser currently understands <code>scene living_room night</code>, <code>show chinami base neutral</code>,
              and dialogue lines like <code>c "Hi!!"</code>.
            </p>
          </div>

          <div v-else class="renpy-player__dialogue">
            <div class="renpy-player__speaker">{{ currentFrame.speaker ?? 'Narrator' }}</div>
            <div class="renpy-player__text">{{ currentFrame.text ?? 'No dialogue on this frame.' }}</div>
          </div>
        </div>
      </div>
    </div>


    <div class="renpy-player__footer">
      <div class="renpy-player__transport">
        <button
          class="vn-btn" type="button" title="Restart"
          :disabled="!canRestart"
          @click="jumpToStart"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button
          class="vn-btn" type="button" title="Previous"
          :disabled="!canStepBack"
          @click="stepBackward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <button
          class="vn-btn vn-btn--autoplay" type="button"
          :title="isAutoplaying ? 'Pause' : 'Autoplay'"
          :class="{ 'vn-btn--active': isAutoplaying }"
          :disabled="!canToggleAutoplay"
          @click="toggleAutoplay"
        >
          <svg v-if="isAutoplaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>{{ isAutoplaying ? 'Pause' : 'Play' }}</span>
        </button>
        <button
          class="vn-btn" type="button" title="Next"
          :disabled="!canStepForward"
          @click="stepForward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </div>

      <div class="renpy-player__status">
        <span v-if="hasFrames" class="vn-pill">{{ frameIndex + 1 }}/{{ frames.length }}</span>
        <span v-if="settings.followLatestPlayable" class="vn-pill vn-pill--auto">Auto</span>
      </div>

      <div class="renpy-player__actions">
        <button class="vn-btn" type="button" title="Jump to latest script" @click="useLatestPlayable">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg>
          <span>Latest</span>
        </button>
        <label class="renpy-player__input-group" title="Jump to message ID">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="opacity:.6"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
          <input
            v-model.number="manualMessageId"
            class="text_pole renpy-player__msg-input"
            type="number" min="0" :max="maxMessageId"
            @change="applyManualMessageId"
          />
        </label>
      </div>
    </div>

    <details class="renpy-player__diagnostics">
      <summary>Diagnostics</summary>
      <div class="renpy-player__diagnostics-grid">
        <p><strong>Source:</strong> {{ parsedScript.source }}</p>
        <p><strong>Max message id:</strong> {{ maxMessageId }}</p>
        <p><strong>Camera:</strong> {{ cameraDiagnosticsLabel }}</p>
        <template v-for="sprite in currentFrame?.sprites" :key="sprite.id">
          <p><strong>Sprite «{{ sprite.id }}» candidates:</strong></p>
          <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
            <li v-for="c in sprite.asset?.candidates" :key="c">{{ c }}</li>
            <li v-if="!sprite.asset?.candidates?.length">None</li>
          </ul>
        </template>
        <p v-if="!currentFrame?.sprites?.length"><strong>Sprites:</strong> None</p>
        <p><strong>Background candidates:</strong></p>
        <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
          <li v-for="c in currentFrame?.background?.candidates" :key="c">{{ c }}</li>
          <li v-if="!currentFrame?.background?.candidates?.length">None</li>
        </ul>
        <p v-if="characterSpriteConfigError"><strong>Character config JSON:</strong> {{ characterSpriteConfigError }}</p>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
// TOC
// 1) imports/types
// 2) store/settings wiring
// 3) core derived model (parsedScript/frames/currentFrame)
// 4) stage geometry + presentation computeds
// 5) actions (selection, transport)
// 6) scene presentation (apply frame -> displayed*)
// 7) sprite visibility transitions (enter/leave)
// 8) watchers
// 9) lifecycle

//#region 1) imports/types
import { storeToRefs } from 'pinia';
import { buildFrames, getInitialState, parseScriptFromMessage } from './parser';
import { useRenpyPlayerSettingsStore } from './settings';
import SmartImage from './SmartImage.vue';
import type { PlayerAsset, PlayerFrame } from './types';

// Smoke checklist:
// - mounts above #chat; latest/manual message selection works
// - restart/back/forward + autoplay controls work and autoplay stops at end
// - scene fade + sprite enter/exit visibility effects behave as configured
// - camera transforms/animations apply; settings persist after reload

type SpriteVisibilityEffect = 'fade' | 'none';
//#endregion

//#region 2) store/settings wiring
const settingsStore = useRenpyPlayerSettingsStore();
const {
  settings,
  assetExtensions,
  globalPoseTokens,
  characterSpriteConfig,
  characterSpriteConfigError,
} = storeToRefs(settingsStore);
//#endregion

//#region 3) core derived model (parsedScript/frames/currentFrame)
const currentMessage = ref<ChatMessage | null>(null);
const historyTrigger = ref(0);
const frameIndex = ref(0);
const isAutoplaying = ref(false);
const manualMessageId = ref<number | null>(settings.value.preferredMessageId);
const autoplayHandle = ref<number | null>(null);
const displayedBackground = ref<PlayerAsset | undefined>();
const displayedSprites = ref<PlayerFrame['sprites']>([]);
const previousDisplayedSprites = ref<PlayerFrame['sprites']>([]);
const isSceneTransitioning = ref(false);
const transitionTimeouts = ref<number[]>([]);
const prefersReducedMotion = ref(false);
const spriteVisibilityAnimations = new WeakMap<Element, Animation>();
const activeSpriteVisibilityAnimations = new Set<Animation>();
const pendingEnterEffectById = new Map<string, SpriteVisibilityEffect>();
const pendingExitEffectById = new Map<string, SpriteVisibilityEffect>();
const lifecycleStopList: Array<() => void> = [];
let reducedMotionQuery: MediaQueryList | null = null;
let reducedMotionChangeHandler: (() => void) | null = null;

const maxMessageId = computed(() => getLastMessageId());

const parsedScript = computed(() => parseScriptFromMessage(currentMessage.value?.message ?? ''));

const frames = computed(() => {
  void historyTrigger.value; // ensure reactivity when events fire

  const history: string[] = [];
  const currentId = currentMessage.value?.message_id;
  if (currentId != null && !Number.isNaN(currentId)) {
    for (let id = currentId - 1; id >= 0; id -= 1) {
      const msg = getChatMessages(id)[0];
      if (msg && msg.message) {
        history.push(msg.message);
      }
    }
  }

  const buildOptions = {
    assetRoot: settings.value.assetRoot,
    assetExtensions: assetExtensions.value,
    characterSpriteConfig: characterSpriteConfig.value,
    defaultSpriteLayout: settings.value.defaultSpriteLayout,
    defaultPose: settings.value.defaultPose,
    defaultExpression: settings.value.defaultExpression,
    globalPoseTokens: globalPoseTokens.value,
  };

  const initialState = getInitialState(history, buildOptions);

  return buildFrames(parsedScript.value, {
    ...buildOptions,
    initialState,
  });
});

const currentFrame = computed(() => frames.value[frameIndex.value] ?? null);

const hasFrames = computed(() => frames.value.length > 0);
const isBusy = computed(() => isSceneTransitioning.value);
const canRestart = computed(() => hasFrames.value && frameIndex.value > 0 && !isBusy.value);
const canStepBack = computed(() => hasFrames.value && frameIndex.value > 0 && !isBusy.value);
const canStepForward = computed(() => hasFrames.value && frameIndex.value < frames.value.length - 1 && !isBusy.value);
const canToggleAutoplay = computed(() => frames.value.length > 1 && !isBusy.value);
//#endregion

//#region 4) stage geometry + presentation computeds
const stageWidth = computed(() => Math.round(settings.value.stageHeight * 16 / 9));

// Stage wrapper: fixed height from settings; CSS handles full width + centering + black bars
const stageWrapStyle = computed(() => ({
  height: `${settings.value.stageHeight}px`,
}));

// Inner stage: fixed ~16:9 box; wrapper flex centers it both horizontally and vertically
const stageStyle = computed(() => ({
  width: `${stageWidth.value}px`,
  height: `${settings.value.stageHeight}px`,
  '--renpy-camera-transition-ms': `${settings.value.cameraTransitionMs}ms`,
}));

function getCameraSettings(transform?: 'closeup' | 'medium') {
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
  const camera = getCameraSettings(currentFrame.value?.cameraTransform);
  return {
    transform: `scale(${camera.backgroundScale})`,
    transformOrigin: 'center center',
    transition: 'transform var(--renpy-camera-transition-ms) ease',
  };
});

const spriteStyle = computed(() => {
  const camera = getCameraSettings(currentFrame.value?.cameraTransform);
  return {
    '--sprite-scale': camera.spriteScale.toString(),
    '--sprite-y': `${camera.spriteY}%`,
  };
});

const cameraAnimationClass = computed(() => getCameraAnimationClass(currentFrame.value?.cameraAnimations));

const cameraDiagnosticsLabel = computed(() => {
  const parts = [currentFrame.value?.cameraTransform ?? 'default', ...(currentFrame.value?.cameraAnimations ?? [])];
  return parts.join(', ');
});

const renderedSprites = computed(() =>
  (displayedSprites.value ?? []).map(sprite => ({
    ...sprite,
    renderKey: sprite.id,
    animationClass: getSpriteAnimationClass(sprite.animations),
    shellStyle: getSpriteShellStyle(sprite.position),
    swapDurationMs: getSpriteSwapDuration(sprite),
  })),
);
//#endregion

//#region 6) scene presentation (apply frame -> displayed*)
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

function clearTransitionTimeouts() {
  transitionTimeouts.value.forEach(timeoutId => window.clearTimeout(timeoutId));
  transitionTimeouts.value = [];
}

function updateDisplayedSprites(nextSprites: PlayerFrame['sprites']) {
  const previousSprites = displayedSprites.value ?? [];
  const next = nextSprites ?? [];
  const previousIds = new Set(previousSprites.map(sprite => sprite.id));
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

  displayedSprites.value = next;
}

function applyFrame(next: PlayerFrame | null, prev: PlayerFrame | null): void {
  clearTransitionTimeouts();

  if (!next) {
    displayedBackground.value = undefined;
    updateDisplayedSprites([]);
    isSceneTransitioning.value = false;
    return;
  }

  if (!prev || next.index === prev.index) {
    displayedBackground.value = next.background;
    updateDisplayedSprites(next.sprites ?? []);
    isSceneTransitioning.value = false;
    return;
  }

  if (next.isNewScene) {
    if (settings.value.sceneTransitionMs <= 0) {
      displayedBackground.value = next.background;
      updateDisplayedSprites(next.sprites ?? []);
      isSceneTransitioning.value = false;
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

  displayedBackground.value = next.background;
  updateDisplayedSprites(next.sprites ?? []);
  isSceneTransitioning.value = false;
}

const sceneFadeStyle = computed(() => ({
  animationDuration: `${settings.value.sceneTransitionMs}ms`,
}));
//#endregion

//#region 7) sprite visibility transitions (enter/leave)
function getSpriteAnimationClass(animations?: string[]): string | undefined {
  if (!animations?.length) {
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
  if (!animations?.length) {
    return undefined;
  }
  if (animations.includes('shake')) {
    return 'renpy-player__scene-layer--shake';
  }
  return undefined;
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
//#endregion

//#region 5) actions (selection, transport)
function findLatestPlayableMessageId(): number | null {
  for (let messageId = getLastMessageId(); messageId >= 0; messageId -= 1) {
    const message = getChatMessages(messageId)[0];
    if (message && parseScriptFromMessage(message.message).commands.length > 0) {
      return messageId;
    }
  }
  return null;
}

function stopAutoplay() {
  if (autoplayHandle.value !== null) {
    window.clearInterval(autoplayHandle.value);
    autoplayHandle.value = null;
  }
  isAutoplaying.value = false;
}

function syncMessageSelection() {
  historyTrigger.value++;
  const messageId = settings.value.followLatestPlayable ? findLatestPlayableMessageId() : settings.value.preferredMessageId;
  settings.value.preferredMessageId = messageId;
  manualMessageId.value = messageId;
  currentMessage.value = messageId === null ? null : getChatMessages(messageId)[0] ?? null;
}

function useLatestPlayable() {
  settings.value.followLatestPlayable = true;
  syncMessageSelection();
  frameIndex.value = 0;
}

function selectMessage(messageId: number) {
  settings.value.followLatestPlayable = false;
  settings.value.preferredMessageId = messageId;
  syncMessageSelection();
  frameIndex.value = 0;
}

function applyManualMessageId() {
  if (manualMessageId.value === null || Number.isNaN(manualMessageId.value)) {
    return;
  }
  selectMessage(manualMessageId.value);
}

function jumpToStart() {
  if (isSceneTransitioning.value) {
    return;
  }
  frameIndex.value = 0;
}

function stepBackward() {
  if (isSceneTransitioning.value) {
    return;
  }
  frameIndex.value = Math.max(0, frameIndex.value - 1);
}

function stepForward() {
  if (isSceneTransitioning.value) {
    return;
  }
  frameIndex.value = Math.min(frames.value.length - 1, frameIndex.value + 1);
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
  }, settings.value.autoPlayDelayMs);
}
//#endregion

//#region 8) watchers
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
    if (nextFrames.length <= 1) {
      stopAutoplay();
    }
  },
  { immediate: true },
);

watch(
  () => currentFrame.value,
  (nextFrame, previousFrame) => {
    applyFrame(nextFrame, previousFrame ?? null);
  },
  { immediate: true },
);

watch(displayedSprites, (nextSprites, previousSprites) => {
  previousDisplayedSprites.value = previousSprites ?? [];
});

watch(
  () => settings.value.autoPlayDelayMs,
  () => {
    if (isAutoplaying.value) {
      stopAutoplay();
      toggleAutoplay();
    }
  },
);
//#endregion

//#region 9) lifecycle
onMounted(() => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionQuery = query;
  reducedMotionChangeHandler = () => {
    prefersReducedMotion.value = query.matches;
  };
  reducedMotionChangeHandler();
  query.addEventListener('change', reducedMotionChangeHandler);

  syncMessageSelection();

  lifecycleStopList.push(
    eventOn(tavern_events.CHAT_CHANGED, syncMessageSelection).stop,
    eventOn(tavern_events.MESSAGE_RECEIVED, syncMessageSelection).stop,
    eventOn(tavern_events.MESSAGE_EDITED, syncMessageSelection).stop,
    eventOn(tavern_events.MESSAGE_UPDATED, syncMessageSelection).stop,
    eventOn(tavern_events.MESSAGE_DELETED, syncMessageSelection).stop,
    eventOn(tavern_events.MESSAGE_SWIPED, syncMessageSelection).stop,
    eventOn(tavern_events.MORE_MESSAGES_LOADED, syncMessageSelection).stop,
  );
});

onBeforeUnmount(() => {
  if (reducedMotionQuery && reducedMotionChangeHandler) {
    reducedMotionQuery.removeEventListener('change', reducedMotionChangeHandler);
  }

  lifecycleStopList.forEach(stop => stop());
  lifecycleStopList.length = 0;

  stopAutoplay();
  clearTransitionTimeouts();

  activeSpriteVisibilityAnimations.forEach(animation => animation.cancel());
  activeSpriteVisibilityAnimations.clear();

  pendingEnterEffectById.clear();
  pendingExitEffectById.clear();
});
//#endregion
</script>

<style lang="scss" scoped>
/* ─── Container ─────────────────────────────────────────────────────────── */
.renpy-player {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 65%, transparent);
  border-radius: 18px;
  overflow: hidden;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--SmartThemeQuoteColor) 14%, transparent), transparent 55%),
    color-mix(in srgb, var(--black30a) 55%, var(--white30a));
  backdrop-filter: blur(18px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.32);
}

/* ─── Stage wrapper: fills panel, clips to stageHeight, shows black bars ── */
.renpy-player__stage-wrap {
  position: relative;
  width: 100%;
  flex-shrink: 0;
  overflow: hidden;
  background: #000; /* letterbox / pillarbox bars */
  display: flex;
  align-items: center;       /* vertical centering (letterbox) */
  justify-content: center;   /* horizontal centering (pillarbox) */
}

/* ─── Fixed 16:9 VN viewport ─────────────────────────────────────────────── */
.renpy-player__stage {
  /* width & height come from stageStyle computed prop (JS) */
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.renpy-player__scene-layer,
.renpy-player__background,
.renpy-player__gradient,
.renpy-player__sprite-layer,
.renpy-player__viewport {
  position: absolute;
  inset: 0;
}

.renpy-player__scene-layer {
  z-index: 1;
}

.renpy-player__background {
  /* Cover the viewport (may crop); camera zoom is applied via transform */
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.renpy-player__viewport {
  z-index: 2;
}

.renpy-player__sprite-layer {
  z-index: 1;
}

.renpy-player__gradient {
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.04) 0%, rgba(0, 0, 0, 0.38) 55%, rgba(0, 0, 0, 0.86) 100%),
    radial-gradient(circle at top, rgba(255, 255, 255, 0.10), transparent 50%);
}

.renpy-player__sprite-shell {
  inset: auto auto 0 0;
  position: absolute;
  transform: translateX(-50%);
  width: min(70%, 460px);
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1;
  transition: left var(--renpy-camera-transition-ms) ease;
}

.renpy-player__sprite {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
  filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.5));
  --sprite-scale: 1;
  --sprite-y: 0%;
  transform: scale(var(--sprite-scale)) translateY(var(--sprite-y));
  transform-origin: center bottom;
  transition: transform var(--renpy-camera-transition-ms) ease;
}

@keyframes renpy-shake {
  0%, 100% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(0); }
  20%       { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(-6px); }
  40%       { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(6px); }
  60%       { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(-4px); }
  80%       { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(4px); }
}

.renpy-player__sprite--shake {
  animation: renpy-shake 0.45s ease-in-out 1;
}

@keyframes renpy-scene-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(5px); }
}

.renpy-player__scene-layer--shake {
  animation: renpy-scene-shake 0.45s ease-in-out 1;
}

.renpy-player__scene-fade {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: #000;
  pointer-events: none;
  animation: renpy-scene-fade ease-in-out;
}

@keyframes renpy-scene-fade {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes renpy-bounce {
  0%, 100% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)); }
  30% { transform: scale(var(--sprite-scale)) translateY(calc(var(--sprite-y) - 20px)); }
  55% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)); }
  75% { transform: scale(var(--sprite-scale)) translateY(calc(var(--sprite-y) - 8px)); }
}

.renpy-player__sprite--bounce {
  animation: renpy-bounce 0.4s ease-out 1;
}

@keyframes renpy-pulse {
  0%, 100% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)); }
  50% { transform: scale(calc(var(--sprite-scale) * 1.06)) translateY(var(--sprite-y)); }
}

.renpy-player__sprite--pulse {
  animation: renpy-pulse 0.4s ease-in-out 1;
}

/* ─── Dialogue box ──────────────────────────────────────────────────────── */
.renpy-player__dialogue {
  position: absolute;
  z-index: 2;
  right: 1rem;
  bottom: 1rem;
  left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.9rem 1.1rem;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(8, 11, 20, 0.82);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255,255,255,0.06);
}

.renpy-player__speaker {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--SmartThemeQuoteColor) 85%, white);
}

.renpy-player__text {
  font-size: 1rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.renpy-player__empty-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  opacity: 0.7;
}

.renpy-player__empty-state p {
  margin: 0;
  max-width: 42rem;
}

/* ─── Footer / bottom bar ───────────────────────────────────────────────── */
.renpy-player__footer {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 0.45rem 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 40%, transparent);
  background: color-mix(in srgb, var(--black30a) 60%, transparent);
  backdrop-filter: blur(10px);
  min-height: 40px;
}

.renpy-player__transport,
.renpy-player__actions {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}

/* ─── Generic compact button ────────────────────────────────────────────── */
.vn-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 55%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 30%, transparent);
  color: inherit;
  font-size: 0.78rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;

  svg { flex-shrink: 0; }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 55%, transparent);
    border-color: color-mix(in srgb, var(--SmartThemeBorderColor) 80%, transparent);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.vn-btn--active {
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 70%, transparent) !important;
  background: color-mix(in srgb, var(--SmartThemeQuoteColor) 18%, transparent) !important;
  color: color-mix(in srgb, var(--SmartThemeQuoteColor) 90%, white);
}

/* Icon-only buttons (no <span>) get tighter padding */
.vn-btn:not(:has(span)):not(.vn-btn--autoplay) {
  padding: 0.28rem 0.38rem;
}

.renpy-player__status {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}

.vn-pill {
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  background: color-mix(in srgb, var(--SmartThemeBorderColor) 28%, transparent);
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 40%, transparent);
  white-space: nowrap;
}

.vn-pill--auto {
  background: color-mix(in srgb, var(--SmartThemeQuoteColor) 22%, transparent);
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 50%, transparent);
  color: color-mix(in srgb, var(--SmartThemeQuoteColor) 90%, white);
}

.renpy-player__input-group {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
  padding: 0.18rem 0.45rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 20%, transparent);
  cursor: text;
}

.renpy-player__msg-input {
  width: 2.8rem;
  background: transparent;
  border: none;
  padding: 0;
  font-size: 0.78rem;
  color: inherit;
  outline: none;

  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    opacity: 0.5;
  }
}

/* ─── Diagnostics ───────────────────────────────────────────────────────── */
.renpy-player__diagnostics {
  border-top: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 40%, transparent);
  padding: 0.5rem 0.75rem 0.65rem;
  font-size: 0.82rem;
}

.renpy-player__diagnostics-grid {
  display: grid;
  gap: 0.4rem;
  padding-top: 0.6rem;
}

.renpy-player__diagnostics-grid p {
  margin: 0;
  overflow-wrap: anywhere;
}


/* ─── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  /* On narrow screens: hide labels in the right-side actions area (icons only there) */
  .renpy-player__actions .vn-btn--autoplay span,
  .renpy-player__actions .vn-btn span {
    display: none;
  }
}
</style>

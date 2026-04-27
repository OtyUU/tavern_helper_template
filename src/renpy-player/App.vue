<template>
  <section class="renpy-player">
    <!-- Wrapper: full width, fixed height (stageHeight), centers the 16:9 stage and shows letter/pillar-box bars -->
    <div class="renpy-player__stage-wrap" :style="stageWrapStyle">
      <!-- Fixed ~16:9 viewport: height = stageHeight, width = round(stageHeight*16/9) -->
      <div class="renpy-player__stage" :style="stageStyle" @click="onStageClick">
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
              say-with-attributes lines like <code>eileen happy "Hi"</code>, and dialogue lines like <code>c "Hi!!"</code>.
            </p>
          </div>
          <template v-else>
            <div class="renpy-player__dialogue-bar">
              <div class="renpy-player__speaker">{{ currentFrame.speaker ?? 'Narrator' }}</div>
              <div class="renpy-player__text">{{ currentFrame.text ?? 'No dialogue on this frame.' }}</div>
            </div>
            <div class="renpy-player__hud-grid" @click.stop>
              <button
                class="renpy-player__hud-button" type="button" title="Restart"
                :disabled="!canRestart"
                @click.stop="jumpToStart"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                <span class="renpy-player__hud-label">RESET</span>
              </button>
              <button
                class="renpy-player__hud-button" type="button" title="Previous"
                :disabled="!canStepBack"
                @click.stop="stepBackward"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                <span class="renpy-player__hud-label">PREV</span>
              </button>
              <button
                class="renpy-player__hud-button" type="button" title="Jump to latest script"
                @click.stop="useLatestPlayable"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg>
                <span class="renpy-player__hud-label">LIVE</span>
              </button>
              <button
                class="renpy-player__hud-button" type="button"
                :title="isAutoplaying ? 'Pause' : 'Autoplay'"
                :class="{ 'renpy-player__hud-button--active': isAutoplaying }"
                :disabled="!canToggleAutoplay"
                @click.stop="toggleAutoplay"
              >
                <svg v-if="isAutoplaying" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span class="renpy-player__hud-label">AUTO</span>
              </button>
              <button
                class="renpy-player__hud-button" type="button" title="Next"
                :disabled="!canStepForward"
                @click.stop="stepForward"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                <span class="renpy-player__hud-label">NEXT</span>
              </button>
              <div class="renpy-player__hud-tile renpy-player__hud-tile--status">
                <span class="renpy-player__hud-label">MODE</span>
                <strong>{{ settings.followLatestPlayable ? 'FOLLOW' : 'MANUAL' }}</strong>
              </div>
              <label
                class="renpy-player__hud-tile renpy-player__hud-input"
                title="Jump to message ID"
                @click.stop
              >
                <span class="renpy-player__hud-label">MSG ID</span>
                <input
                  v-model.number="manualMessageId"
                  class="renpy-player__msg-input"
                  type="number" min="0" :max="maxMessageId"
                  @click.stop
                  @change="applyManualMessageId"
                />
              </label>
              <div v-if="hasFrames" class="renpy-player__hud-tile renpy-player__hud-tile--counter">
                <span class="renpy-player__hud-label">FRAME</span>
                <strong>{{ frameIndex + 1 }}/{{ frames.length }}</strong>
              </div>
            </div>
          </template>
          <details class="renpy-player__diagnostics" @click.stop>
            <summary @click.stop>Diagnostics</summary>
            <div class="renpy-player__diagnostics-grid">
              <p><strong>Source:</strong> {{ parsedScript.source }}</p>
              <p><strong>Max message id:</strong> {{ maxMessageId }}</p>
              <p><strong>Camera:</strong> {{ cameraDiagnosticsLabel }}</p>
              <template v-for="sprite in currentFrame?.sprites" :key="sprite.id">
                <p><strong>Sprite {{ sprite.id }} candidates:</strong></p>
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
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// TOC
// 1) imports/types/internal composables
// 2) store/settings wiring
// 3) core derived model (parsedScript/frames/currentFrame)
// 4) stage geometry + presentation computeds
// 5) scene presentation (apply frame -> displayed*)
// 6) sprite visibility transitions (enter/leave)
// 7) actions (selection, transport + autoplay)
// 8) cross-cutting watchers
// 9) lifecycle

//#region 1) imports/types/internal composables
import { storeToRefs } from 'pinia';
import { buildFrames, getInitialState, parseScriptFromMessage } from './parser';
import {
  useAutoplay,
  useReducedMotion,
  useScenePresentation,
  useSpriteVisibilityTransitions,
} from './player-composables';
import { useRenpyPlayerSettingsStore } from './settings';
import SmartImage from './SmartImage.vue';
import type { PlayerFrame } from './types';

// Smoke checklist:
// - mounts above #chat; latest/manual message selection works
// - restart/back/forward + autoplay controls work and autoplay stops at end
// - scene fade + sprite enter/exit visibility effects behave as configured
// - camera transforms/animations apply; settings persist after reload
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
const manualMessageId = ref<number | null>(settings.value.preferredMessageId);
const isSceneTransitioning = ref(false);
const {
  prefersReducedMotion,
  setup: setupReducedMotion,
  cleanup: cleanupReducedMotion,
} = useReducedMotion();
const {
  onSpriteEnter,
  onSpriteLeave,
  prepareSpriteVisibilityEffects,
  clearSpriteVisibilityTransitions,
} = useSpriteVisibilityTransitions(
  settings,
  isSceneTransitioning,
  prefersReducedMotion,
);
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
);
const lifecycleStopList: Array<() => void> = [];

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
const autoPlayDelayMs = computed(() => settings.value.autoPlayDelayMs);

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

//#region 5) scene presentation (apply frame -> displayed*)
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
//#endregion

//#region 6) sprite visibility transitions (enter/leave)
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
//#endregion

//#region 7) actions (selection, transport + autoplay)
function findLatestPlayableMessageId(): number | null {
  for (let messageId = getLastMessageId(); messageId >= 0; messageId -= 1) {
    const message = getChatMessages(messageId)[0];
    if (message && parseScriptFromMessage(message.message).commands.length > 0) {
      return messageId;
    }
  }
  return null;
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

function onStageClick() {
  if (!hasFrames.value || isSceneTransitioning.value) {
    return;
  }

  if (isAutoplaying.value) {
    stopAutoplay();
    return;
  }

  stepForward();
}

const { isAutoplaying, stopAutoplay, toggleAutoplay } = useAutoplay(
  frames,
  frameIndex,
  isSceneTransitioning,
  autoPlayDelayMs,
  stepForward,
);
//#endregion

//#region 8) cross-cutting watchers
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
//#endregion

//#region 9) lifecycle
onMounted(() => {
  setupReducedMotion();

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
  cleanupReducedMotion();

  lifecycleStopList.forEach(stop => stop());
  lifecycleStopList.length = 0;

  stopAutoplay();
  clearTransitionTimeouts();
  clearSpriteVisibilityTransitions();
});
//#endregion
</script>

<style lang="scss">
@font-face {
  font-family: 'RenpyRounded';
  src:
    local('M PLUS Rounded 1c'),
    local('Kosugi Maru'),
    local('Hiragino Maru Gothic ProN'),
    local('Yu Gothic UI'),
    local('Meiryo');
  font-display: swap;
}
</style>
<style lang="scss" scoped>
/* ????????? Container ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
.renpy-player {
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
/* ????????? Stage wrapper: fills panel, clips to stageHeight, shows black bars ?????? */
.renpy-player__stage-wrap {
  position: relative;
  width: 100%;
  flex-shrink: 0;
  overflow: hidden;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* ????????? Fixed 16:9 VN viewport ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
.renpy-player__stage {
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
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.renpy-player__viewport {
  z-index: 50;
  pointer-events: none;
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
  20% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(-6px); }
  40% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(6px); }
  60% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(-4px); }
  80% { transform: scale(var(--sprite-scale)) translateY(var(--sprite-y)) translateX(4px); }
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
/* ????????? Dialogue/HUD overlay ??????????????????????????????????????????????????????????????????????????????????????????????????? */
.renpy-player__dialogue-bar,
.renpy-player__hud-grid,
.renpy-player__diagnostics {
  pointer-events: auto;
}
.renpy-player__dialogue-bar {
  position: absolute;
  inset: auto 0 0;
  z-index: 55;
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  padding: 1.5rem 2rem 1.7rem;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  background: linear-gradient(to bottom, transparent, rgba(10, 15, 30, 0.7) 20%, rgba(10, 15, 30, 0.85));
  font-family: 'RenpyRounded', 'Hiragino Maru Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif;
}
.renpy-player__speaker {
  align-self: center;
  color: #ff7b93;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.1;
  text-shadow:
    -1px -1px 0 #000,
     1px -1px 0 #000,
    -1px 1px 0 #000,
     1px 1px 0 #000,
     0 2px 4px rgba(0, 0, 0, 0.6);
}
.renpy-player__text {
  color: #fff;
  font-size: 1.25rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-shadow:
    -1px -1px 0 #000,
     1px -1px 0 #000,
    -1px 1px 0 #000,
     1px 1px 0 #000,
     0 2px 4px rgba(0, 0, 0, 0.6);
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
.renpy-player__hud-grid {
  position: absolute;
  right: 1rem;
  bottom: 5rem;
  z-index: 60;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  width: min(15rem, calc(100% - 2rem));
}
.renpy-player__hud-button,
.renpy-player__hud-tile {
  min-height: 4rem;
  padding: 0.45rem 0.35rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  font-family: 'RenpyRounded', 'Hiragino Maru Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif;
}
.renpy-player__hud-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.renpy-player__hud-button svg {
  flex-shrink: 0;
}
.renpy-player__hud-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.35);
}
.renpy-player__hud-button:disabled {
  opacity: 0.38;
  cursor: default;
}
.renpy-player__hud-button--active {
  background: rgba(255, 123, 147, 0.2);
  border-color: rgba(255, 160, 177, 0.45);
}
.renpy-player__hud-tile {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.2rem;
  text-align: center;
}
.renpy-player__hud-tile--status strong,
.renpy-player__hud-tile--counter strong {
  font-size: 0.92rem;
  letter-spacing: 0.04em;
}
.renpy-player__hud-input {
  grid-column: span 2;
  align-items: flex-start;
  text-align: left;
  cursor: text;
}
.renpy-player__hud-label {
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  line-height: 1.1;
  text-transform: uppercase;
}
.renpy-player__msg-input {
  width: 100%;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 0.3rem 0.4rem;
  font-size: 0.95rem;
  color: inherit;
  outline: none;
  margin-top: 0.1rem;
}
.renpy-player__msg-input::-webkit-inner-spin-button,
.renpy-player__msg-input::-webkit-outer-spin-button {
  opacity: 0.5;
}
/* ????????? Diagnostics ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
.renpy-player__diagnostics {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 65;
  font-size: 0.82rem;
  max-width: min(22rem, calc(100% - 1.5rem));
  color: #fff;
}
.renpy-player__diagnostics summary {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(6, 9, 16, 0.72);
  backdrop-filter: blur(10px);
  cursor: pointer;
  list-style: none;
}
.renpy-player__diagnostics summary::-webkit-details-marker {
  display: none;
}
.renpy-player__diagnostics-grid {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(6, 9, 16, 0.78);
  backdrop-filter: blur(10px);
}
.renpy-player__diagnostics-grid p {
  margin: 0;
  overflow-wrap: anywhere;
}
/* ????????? Responsive ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
@media (max-width: 900px) {
  .renpy-player__dialogue-bar {
    grid-template-columns: 132px minmax(0, 1fr);
    padding: 1.1rem 1rem 1.25rem;
  }
  .renpy-player__speaker {
    font-size: 1.2rem;
  }
  .renpy-player__text {
    font-size: 1.02rem;
  }
  .renpy-player__hud-grid {
    right: 0.65rem;
    bottom: 4.2rem;
    width: min(12.5rem, calc(100% - 1.3rem));
  }
  .renpy-player__hud-button,
  .renpy-player__hud-tile {
    min-height: 3.35rem;
  }
  .renpy-player__hud-label {
    font-size: 0.56rem;
  }
}
@media (max-width: 640px) {
  .renpy-player__dialogue-bar {
    grid-template-columns: 1fr;
    gap: 0.4rem;
    padding-right: 7.25rem;
  }
  .renpy-player__speaker {
    align-self: start;
  }
  .renpy-player__hud-grid {
    bottom: 4.8rem;
    width: 6.2rem;
    grid-template-columns: 1fr;
  }
  .renpy-player__hud-input,
  .renpy-player__hud-tile--counter {
    grid-column: auto;
  }
}
</style>

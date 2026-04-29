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
                @resolved="onSpriteResolved(sprite.id, sprite.assetKey, $event)"
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
            <div class="renpy-player__hud-shell">
              <div class="renpy-player__dialogue-bar">
                <div class="renpy-player__speaker">{{ currentFrame.speaker ?? 'Narrator' }}</div>
                <div class="renpy-player__text">{{ currentFrame.text ?? 'No dialogue on this frame.' }}</div>
              </div>
              <div class="renpy-player__hud-rail" @click.stop>
                <div class="renpy-player__rail-row">
                  <button
                    class="renpy-player__hud-button"
                    type="button"
                    title="Restart"
                    aria-label="Restart"
                    :disabled="!canRestart"
                    @click.stop="jumpToStart"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                  </button>
                  <button
                    class="renpy-player__hud-button"
                    type="button"
                    title="Previous"
                    aria-label="Previous"
                    :disabled="!canStepBack"
                    @click.stop="stepBackward"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                  </button>
                  <button
                    class="renpy-player__hud-button"
                    type="button"
                    title="Jump to latest script"
                    aria-label="Jump to latest script"
                    @click.stop="useLatestPlayable"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg>
                  </button>
                  <button
                    class="renpy-player__hud-button"
                    type="button"
                    :title="isAutoplaying ? 'Pause' : 'Autoplay'"
                    :aria-label="isAutoplaying ? 'Pause' : 'Autoplay'"
                    :aria-pressed="isAutoplaying"
                    :class="{ 'renpy-player__hud-button--active': isAutoplaying }"
                    :disabled="!canToggleAutoplay"
                    @click.stop="toggleAutoplay"
                  >
                    <svg v-if="isAutoplaying" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                    <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                </div>
                <div class="renpy-player__rail-divider"></div>
                <div class="renpy-player__rail-bottom">
                  <div class="renpy-player__stepper" title="Jump to message ID" @click.stop>
                    <button
                      class="renpy-player__stepper-button"
                      type="button"
                      aria-label="Previous message"
                      :disabled="!canSelectPreviousMessage"
                      @click.stop="nudgeManualMessageId(-1)"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 7.25h10v1.5H3z"/></svg>
                    </button>
                    <input
                      :value="manualMessageId ?? ''"
                      class="renpy-player__msg-input"
                      type="text"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      autocomplete="off"
                      @click.stop
                      @input="onManualMessageInput"
                      @change="applyManualMessageId"
                      @blur="applyManualMessageId"
                    />
                    <button
                      class="renpy-player__stepper-button"
                      type="button"
                      aria-label="Next message"
                      :disabled="!canSelectNextMessage"
                      @click.stop="nudgeManualMessageId(1)"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z"/></svg>
                    </button>
                  </div>
                  <div v-if="hasFrames" class="renpy-player__frame-count">
                    <strong>{{ frameIndex + 1 }}/{{ frames.length }}</strong>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <details class="renpy-player__diagnostics" @click.stop>
            <summary @click.stop title="Diagnostics" aria-label="Diagnostics">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>
            </summary>
            <div class="renpy-player__diagnostics-grid">
              <p><strong>Source:</strong> {{ parsedScript.source }}</p>
              <p><strong>Max message id:</strong> {{ maxMessageId }}</p>
              <p><strong>Camera:</strong> {{ cameraDiagnosticsLabel }}</p>
              <template v-for="sprite in currentFrame?.sprites" :key="sprite.id">
                <p><strong>Sprite {{ sprite.id }}:</strong></p>
                <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
                  <li>Reference height: {{ getSpriteReferenceHeight(sprite.id) }}px</li>
                  <li>Natural height (resolved): {{ getSpriteNaturalHeight(sprite) }}px</li>
                  <li>Baseline height (configured): {{ getSpriteBaselineHeight(sprite.id) ?? 'none' }}</li>
                  <li>Normalization scale: {{ formatNormalizationScale(getSpriteNormalizationScale(sprite)) }}</li>
                  <li>Offset X: {{ getSpriteTotalOffset(sprite.id, sprite.pose).x }}px</li>
                  <li>Offset Y: {{ getSpriteTotalOffset(sprite.id, sprite.pose).y }}px</li>
                  <li v-if="sprite.asset?.candidates?.length">Candidates:</li>
                  <li v-for="c in sprite.asset?.candidates" :key="c" style="padding-left:1rem;">{{ c }}</li>
                  <li v-if="!sprite.asset?.candidates?.length">No asset candidates</li>
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

type ResolvedSpriteOffset = { x: number; y: number };

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
const spriteAssetMetrics = ref<Record<string, { assetKey: string; naturalHeight: number }>>({});

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
const canSelectPreviousMessage = computed(() => (manualMessageId.value ?? 0) > 0);
const canSelectNextMessage = computed(() => {
  if (manualMessageId.value === null || Number.isNaN(manualMessageId.value)) {
    return false;
  }

  return manualMessageId.value < maxMessageId.value;
});
//#endregion

//#region 4) stage geometry + presentation computeds
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const stageWidth = computed(() => Math.round(settings.value.stageHeight * 16 / 9));
const hudScale = computed(() => clampNumber(settings.value.stageHeight / 480, 0.72, 1.42));

// Stage wrapper: fixed height from settings; CSS handles full width + centering + black bars
const stageWrapStyle = computed(() => ({
  height: `${settings.value.stageHeight}px`,
}));

// Inner stage: fixed ~16:9 box; wrapper flex centers it both horizontally and vertically
const stageStyle = computed(() => ({
  width: `${stageWidth.value}px`,
  height: `${settings.value.stageHeight}px`,
  '--renpy-camera-transition-ms': `${settings.value.cameraTransitionMs}ms`,
  '--stage-height': `${settings.value.stageHeight}px`,
  '--renpy-ui-scale': hudScale.value.toFixed(3),

  /* Flush to bottom, no gaps */
  '--renpy-shell-pad-x': `0px`,
  '--renpy-shell-pad-bottom': `0px`,
  '--renpy-shell-gap': `0px`,

  /* Thinner dialogue area */
  '--renpy-dialogue-min-height': `${clampNumber(Math.round(110 * hudScale.value), 80, 160)}px`,
  '--renpy-dialogue-pad-x': `${clampNumber(Math.round(40 * hudScale.value), 20, 60)}px`,
  '--renpy-dialogue-pad-top': `${clampNumber(Math.round(16 * hudScale.value), 12, 24)}px`,
  '--renpy-dialogue-pad-bottom': `${clampNumber(Math.round(16 * hudScale.value), 12, 24)}px`,
  '--renpy-dialogue-gap': `${clampNumber(Math.round(24 * hudScale.value), 16, 40)}px`,

  /* Smaller Typography */
  '--renpy-speaker-col': `${clampNumber(Math.round(140 * hudScale.value), 100, 180)}px`,
  '--renpy-speaker-size': `${clampNumber(Math.round(24 * hudScale.value), 18, 32)}px`,
  '--renpy-text-size': `${clampNumber(Math.round(18 * hudScale.value), 14, 24)}px`,

  /* Compact control rail */
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
  (displayedSprites.value ?? []).map(sprite => {
    const referenceHeight = getSpriteReferenceHeight(sprite.id);
    const totalOffset = getSpriteTotalOffset(sprite.id, sprite.pose);
    const normalizationScale = getSpriteNormalizationScale(sprite);
    const assetKey = getSpriteAssetKey(sprite);

    return {
      ...sprite,
      renderKey: sprite.id,
      animationClass: getSpriteAnimationClass(sprite.animations),
      shellStyle: {
        ...getSpriteShellStyle(sprite.position),
        '--sprite-offset-x': `${totalOffset.x}px`,
        '--sprite-offset-y': `${totalOffset.y}px`,
        '--sprite-ref-height': `${referenceHeight}px`,
        '--sprite-normalize-scale': `${normalizationScale}`,
      },
      swapDurationMs: getSpriteSwapDuration(sprite),
      referenceHeight,
      assetKey,
      normalizationScale,
    };
  }),
);
//#endregion

//#region 5) scene presentation (apply frame -> displayed*)
function getSpriteReferenceHeight(spriteId: string): number {
  return characterSpriteConfig.value[spriteId]?.referenceHeight ?? settings.value.spriteReferenceHeight;
}

function getSpriteBaselineHeight(spriteId: string): number | null {
  const configured = characterSpriteConfig.value[spriteId]?.baselineHeight;
  return configured && Number.isFinite(configured) && configured > 0 ? configured : null;
}

function getSpriteBaseOffset(spriteId: string): ResolvedSpriteOffset {
  const raw = characterSpriteConfig.value[spriteId]?.baseOffset;
  return {
    x: raw?.x ?? 0,
    y: raw?.y ?? 0,
  };
}

function getSpritePoseOffset(spriteId: string, pose?: string): ResolvedSpriteOffset {
  const raw = pose ? characterSpriteConfig.value[spriteId]?.poseOffsets?.[pose] : undefined;
  return {
    x: raw?.x ?? 0,
    y: raw?.y ?? 0,
  };
}

function getSpriteTotalOffset(spriteId: string, pose?: string): ResolvedSpriteOffset {
  const baseOffset = getSpriteBaseOffset(spriteId);
  const poseOffset = getSpritePoseOffset(spriteId, pose);
  return {
    x: baseOffset.x + poseOffset.x,
    y: baseOffset.y + poseOffset.y,
  };
}

function getSpriteAssetKey(sprite: PlayerFrame['sprites'][number]): string {
  return sprite.asset?.candidates?.join('|') ?? sprite.asset?.description ?? '';
}

function getSpriteNaturalHeight(sprite: PlayerFrame['sprites'][number]): number {
  const assetKey = getSpriteAssetKey(sprite);
  const metrics = spriteAssetMetrics.value[sprite.id];
  return metrics?.assetKey === assetKey ? metrics.naturalHeight : getSpriteReferenceHeight(sprite.id);
}

function getSpriteNormalizationScale(sprite: PlayerFrame['sprites'][number]): number {
  const referenceHeight = getSpriteReferenceHeight(sprite.id);
  const naturalHeight = getSpriteNaturalHeight(sprite);
  const baselineHeight = getSpriteBaselineHeight(sprite.id);

  if (baselineHeight) {
    return naturalHeight > 0 ? naturalHeight / baselineHeight : 1;
  }

  return naturalHeight > 0 ? referenceHeight / naturalHeight : 1;
}

function formatNormalizationScale(value: number): string {
  return value.toFixed(4);
}

function onSpriteResolved(
  spriteId: string,
  assetKey: string,
  payload: { naturalHeight: number },
) {
  spriteAssetMetrics.value = {
    ...spriteAssetMetrics.value,
    [spriteId]: {
      assetKey,
      naturalHeight: payload.naturalHeight,
    },
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

  manualMessageId.value = clampNumber(Math.round(manualMessageId.value), 0, maxMessageId.value);
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
  width: auto;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1;
  transition: left var(--renpy-camera-transition-ms) ease;
  --sprite-ref-height: 2000px;
  --sprite-offset-x: 0px;
  --sprite-offset-y: 0px;
  --sprite-normalize-scale: 1;
}
.renpy-player__sprite {
  display: block;
  height: 100%;
  filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.5));
  --sprite-scale: 1;
  --sprite-y: 0%;
  --sprite-transform-x: var(--sprite-offset-x);
  --sprite-transform-y: calc(var(--sprite-y) + var(--sprite-offset-y));
  transform:
    translateX(var(--sprite-transform-x))
    translateY(var(--sprite-transform-y))
    scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale)));
  transform-origin: center bottom;
  transition: transform var(--renpy-camera-transition-ms) ease;
}

/* SmartImage root element has class "smart-image" + "renpy-player__sprite".
   Override SmartImage default width:100% so the sprite width becomes intrinsic (based on image aspect ratio). */
.smart-image.renpy-player__sprite {
  width: auto;
}

/* Make the actual <img> layers size by height, not by fitting into a capped box */
.smart-image.renpy-player__sprite :deep(.smart-image__layer) {
  width: auto;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
}

/* SmartImage previous layer uses position:absolute; inset:0 by default, which would force width stretching.
   For sprites, anchor it without left+right constraints so width:auto can work. */
.smart-image.renpy-player__sprite :deep(.smart-image__layer--previous) {
  inset: auto;
  left: 0;
  bottom: 0;
}
@keyframes renpy-shake {
  0%, 100% { transform: translateX(calc(var(--sprite-transform-x) + 0px)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  20% { transform: translateX(calc(var(--sprite-transform-x) - 6px)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  40% { transform: translateX(calc(var(--sprite-transform-x) + 6px)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  60% { transform: translateX(calc(var(--sprite-transform-x) - 4px)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  80% { transform: translateX(calc(var(--sprite-transform-x) + 4px)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
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
  0%, 100% { transform: translateX(var(--sprite-transform-x)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  30% { transform: translateX(var(--sprite-transform-x)) translateY(calc(var(--sprite-transform-y) - 20px)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  55% { transform: translateX(var(--sprite-transform-x)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  75% { transform: translateX(var(--sprite-transform-x)) translateY(calc(var(--sprite-transform-y) - 8px)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
}
.renpy-player__sprite--bounce {
  animation: renpy-bounce 0.4s ease-out 1;
}
@keyframes renpy-pulse {
  0%, 100% { transform: translateX(var(--sprite-transform-x)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale))); }
  50% { transform: translateX(var(--sprite-transform-x)) translateY(var(--sprite-transform-y)) scale(calc(var(--sprite-scale) * var(--sprite-normalize-scale) * 1.06)); }
}
.renpy-player__sprite--pulse {
  animation: renpy-pulse 0.4s ease-in-out 1;
}
/* ????????? Dialogue/HUD overlay ??????????????????????????????????????????????????????????????????????????????????????????????????? */
.renpy-player__dialogue-bar,
.renpy-player__hud-rail,
.renpy-player__diagnostics {
  pointer-events: auto;
}
.renpy-player__hud-shell {
  position: absolute;
  inset: auto 0 -1px;
  z-index: 60;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--renpy-rail-width);
  align-items: stretch;
  gap: var(--renpy-shell-gap);
  padding: 0 var(--renpy-shell-pad-x) var(--renpy-shell-pad-bottom);
  pointer-events: none;
  background: linear-gradient(180deg, rgba(7, 15, 30, 0) 0%, rgba(7, 15, 30, 0.4) 25%, rgba(7, 15, 30, 0.8) 100%);
  border-top: 1px solid rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(4px);
}
.renpy-player__dialogue-bar {
  display: grid;
  grid-template-columns: minmax(0, var(--renpy-speaker-col)) minmax(0, 1fr);
  gap: var(--renpy-dialogue-gap);
  align-items: start;
  min-height: var(--renpy-dialogue-min-height);
  padding:
    var(--renpy-dialogue-pad-top)
    var(--renpy-dialogue-pad-x)
    var(--renpy-dialogue-pad-bottom);
  font-family: 'RenpyRounded', 'Hiragino Maru Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif;
}
.renpy-player__speaker {
  align-self: start;
  color: #ff8e9d;
  font-size: var(--renpy-speaker-size);
  font-weight: 600;
  letter-spacing: 0.05em;
  line-height: 1.2;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(0, 0, 0, 0.5);
}
.renpy-player__text {
  color: #fff;
  align-self: start;
  font-size: var(--renpy-text-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8), 0 0 4px rgba(0, 0, 0, 0.5);
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

.renpy-player__hud-rail {
  display: inline-flex;
  flex-direction: column;
  justify-content: flex-end;
  align-self: end;
  min-width: var(--renpy-rail-width);
  width: var(--renpy-rail-width);
  transform: translateX(calc(var(--renpy-dialogue-pad-x) * 0.42));
  padding:
    var(--renpy-control-row-pad-y)
    var(--renpy-dialogue-pad-x)
    var(--renpy-control-row-pad-y)
    0;
  pointer-events: auto;
}
.renpy-player__rail-row {
  display: flex;
  justify-content: flex-end;
  gap: var(--renpy-control-gap);
  padding: 0 var(--renpy-control-row-pad-x);
}
.renpy-player__rail-divider {
  height: 1px;
  margin: 6px var(--renpy-control-row-pad-x) 7px;
  background: rgba(255, 255, 255, 0.08);
}
.renpy-player__hud-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--renpy-control-button-width);
  height: var(--renpy-control-button-height);
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.72);
  font-family: 'RenpyRounded', 'Hiragino Maru Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}
.renpy-player__hud-button svg {
  flex-shrink: 0;
  width: var(--renpy-control-icon);
  height: var(--renpy-control-icon);
}
.renpy-player__hud-button:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.renpy-player__hud-button:disabled {
  color: rgba(255, 255, 255, 0.22);
  cursor: default;
}
.renpy-player__hud-button--active {
  color: #aae4ff;
  background: rgba(170, 228, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(170, 228, 255, 0.16);
}
.renpy-player__rail-bottom,
 .renpy-player__stepper {
  display: flex;
  align-items: center;
}
.renpy-player__rail-bottom {
  justify-content: flex-end;
  gap: 10px;
  padding: 0 var(--renpy-control-row-pad-x);
}
.renpy-player__stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.renpy-player__stepper-button {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--renpy-stepper-button-size);
  height: var(--renpy-stepper-button-size);
  padding: 0;
  background: none;
  border: none;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease;
}
.renpy-player__stepper-button:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}
.renpy-player__stepper-button:disabled {
  color: rgba(255, 255, 255, 0.2);
  cursor: default;
}
.renpy-player__msg-input {
  flex: 0 0 auto;
  appearance: textfield;
  -moz-appearance: textfield;
  -webkit-appearance: none;
  width: var(--renpy-stepper-input-width);
  padding: 0;
  background: none;
  border: none;
  font-size: var(--renpy-input-size);
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.76);
  outline: none;
  text-align: center;
  cursor: text;
}
.renpy-player__msg-input:focus {
  color: #fff;
}
.renpy-player__msg-input::-webkit-inner-spin-button,
.renpy-player__msg-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  display: none;
  margin: 0;
}
.renpy-player__frame-count {
  display: inline-flex;
  align-items: baseline;
  color: rgba(255, 255, 255, 0.36);
  font-size: var(--renpy-input-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 0;
  text-align: right;
}
.renpy-player__frame-count strong {
  color: rgba(255, 255, 255, 0.74);
  font-weight: 500;
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
  justify-content: center;
  width: var(--renpy-control-button-width);
  height: var(--renpy-control-button-height);
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  list-style: none;
  transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}
.renpy-player__diagnostics summary:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.renpy-player__diagnostics summary svg {
  flex-shrink: 0;
  width: var(--renpy-control-icon);
  height: var(--renpy-control-icon);
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
  .renpy-player__hud-shell {
    grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
  }
  .renpy-player__dialogue-bar {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .renpy-player__hud-rail {
    min-width: min(100%, 232px);
    width: min(100%, 232px);
  }
}
@media (max-width: 640px) {
  .renpy-player__hud-shell {
    display: flex;
    flex-direction: column;
    padding: var(--renpy-dialogue-pad-top) var(--renpy-dialogue-pad-x);
  }
  .renpy-player__dialogue-bar,
  .renpy-player__hud-rail {
    padding: 0;
  }
  .renpy-player__hud-rail {
    width: 100%;
    min-width: 0;
    max-width: 280px;
    align-self: center;
    transform: none;
    margin-top: 12px;
  }
  .renpy-player__rail-row {
    justify-content: center;
  }
  .renpy-player__rail-bottom {
    justify-content: flex-end;
  }
}
</style>

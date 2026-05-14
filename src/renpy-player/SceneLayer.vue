<template>
  <div
    class="renpy-player__scene-layer" 
    :class="controller.scene.cameraAnimationClass"
  >
    <div
      v-if="controller.scene.isSceneTransitioning"
      class="renpy-player__scene-fade"
      :style="controller.scene.sceneFadeStyle"
    ></div>

    <div
      ref="bgCameraRef"
      class="renpy-player__camera-layer renpy-player__camera-layer--bg"
      :class="controller.scene.cameraLayerAnimatingClass"
      :style="controller.scene.backgroundCameraStyle"
    >
      <SmartImage
        v-if="controller.scene.displayedBackground?.candidates?.length"
        class="renpy-player__background"
        :candidates="controller.scene.displayedBackground.candidates"
        :alt="controller.scene.displayedBackground.description"
        :resample-target-height="controller.scene.backgroundResampleTargetHeight"
        @resolution-status="controller.diagnostics.onAssetResolutionStatus('__background__', $event)"
        @swap-start="controller.scene.onSmartImageSwapStart('__background__', $event)"
      />
    </div>

    <div
      ref="spriteCameraRef"
      class="renpy-player__camera-layer renpy-player__camera-layer--sprites"
      :class="controller.scene.cameraLayerAnimatingClass"
      :style="controller.scene.spriteCameraStyle"
    >
      <TransitionGroup
        tag="div"
        class="renpy-player__sprite-layer"
        :css="false"
        @enter="controller.scene.onSpriteEnter"
        @leave="controller.scene.onSpriteLeave"
      >
        <div
          v-for="sprite in controller.scene.renderedSprites"
          :key="sprite.renderKey"
          ref="spriteShellRefs"
          class="renpy-player__sprite-shell"
          :data-sprite-id="sprite.id"
          :style="sprite.shellStyle"
        >
          <SmartImage
            class="renpy-player__sprite"
            :class="sprite.animationClass"
            :style="controller.scene.spriteStyle"
            :candidates="sprite.asset?.candidates ?? []"
            :alt="sprite.asset?.description ?? sprite.id"
            :swap-duration-ms="sprite.swapDurationMs"
            :resample-target-height="Math.round(controller.scene.spriteBaseResampleTargetHeight * sprite.normalizeScale)"
            @resolved="controller.scene.onSpriteResolved(sprite.id, $event)"
            @resolution-status="controller.diagnostics.onAssetResolutionStatus(sprite.id, $event)"
            @swap-start="controller.scene.onSmartImageSwapStart(sprite.id, $event)"
          />
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRenpyPlayer } from './player-context';
import SmartImage from './SmartImage.vue';

const controller = useRenpyPlayer();

const bgCameraRef = ref<HTMLElement | null>(null);
const spriteCameraRef = ref<HTMLElement | null>(null);
const spriteShellRefs = ref<HTMLElement[]>([]);

onMounted(() => {
  controller.scene.setBackgroundCameraElement(bgCameraRef.value);
  controller.scene.setSpriteCameraElement(spriteCameraRef.value);
});

watch(
  () => controller.scene.renderedSprites.map(s => `${s.id}:${s.position}`).join('|'),
  (signature, prevSignature) => {
    if (!prevSignature) return;
    if (signature === prevSignature) return;
    controller.scene.trackSpritePositionTransitions(spriteShellRefs.value);
  },
  { flush: 'post' }
);

onUnmounted(() => {
  controller.scene.setBackgroundCameraElement(null);
  controller.scene.setSpriteCameraElement(null);
});
</script>
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
        :resample-target-height="controller.scene.spriteResampleTargetHeight"
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
          class="renpy-player__sprite-shell"
          :data-sprite-id="sprite.id"
        >
          <div
            class="renpy-player__sprite-fx"
            :class="sprite.fxAnimationClass"
          >
            <div
              ref="spriteMotionRefs"
              class="renpy-player__sprite-motion"
              :data-sprite-id="sprite.id"
              :style="sprite.motionStyle"
            >
              <div
                class="renpy-player__sprite-pulse"
                :class="sprite.pulseAnimationClass"
              >
                <div
                  class="renpy-player__sprite-normalize"
                  :style="sprite.normalizeStyle"
                >
                  <SmartImage
                    class="renpy-player__sprite"
                    :candidates="sprite.asset?.candidates ?? []"
                    :alt="sprite.asset?.description ?? sprite.id"
                    :swap-duration-ms="sprite.swapDurationMs"
                    :resample-target-height="controller.scene.spriteResampleTargetHeight"
                    @resolved="controller.scene.onSpriteResolved(sprite.id, $event)"
                    @resolution-status="controller.diagnostics.onAssetResolutionStatus(sprite.id, $event)"
                    @swap-start="controller.scene.onSmartImageSwapStart(sprite.id, $event)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRenpyPlayer } from './player-context';
import SmartImage from './SmartImage.vue';

const controller = useRenpyPlayer();

const bgCameraRef = ref<HTMLElement | null>(null);
const spriteCameraRef = ref<HTMLElement | null>(null);
const spriteMotionRefs = ref<HTMLElement[]>([]);

onMounted(() => {
  controller.scene.setBackgroundCameraElement(bgCameraRef.value);
  controller.scene.setSpriteCameraElement(spriteCameraRef.value);

  nextTick(() => {
    controller.scene.trackSpritePositionTransitions(spriteMotionRefs.value);
  });
});

watch(
  () => controller.scene.renderedSprites.map(s => `${s.id}:${s.motionStyle?.transform ?? ''}`).join('|'),
  (signature, prevSignature) => {
    if (signature === prevSignature) return;
    controller.scene.trackSpritePositionTransitions(spriteMotionRefs.value);
  },
  { flush: 'post' }
);

onUnmounted(() => {
  controller.scene.setBackgroundCameraElement(null);
  controller.scene.setSpriteCameraElement(null);
});
</script>
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
      :style="controller.scene.backgroundCameraStyle"
    >
      <SmartImage
        v-if="controller.scene.displayedBackground?.candidates?.length"
        class="renpy-player__background"
        :candidates="controller.scene.displayedBackground.candidates"
        :alt="controller.scene.displayedBackground.description"
        @resolution-status="controller.diagnostics.onAssetResolutionStatus('__background__', $event)"
        @swap-start="controller.scene.onSmartImageSwapStart('__background__', $event)"
      />
    </div>

    <div
      ref="spriteCameraRef"
      class="renpy-player__camera-layer renpy-player__camera-layer--sprites"
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

/**
 * Track sprite position transitions (horizontal movement via CSS transform).
 * 
 * Fires when renderedSprites change (add/remove/reorder/position).
 * trackSpritePositionTransitions() internally filters to only track sprites
 * whose position actually changed (compares displayedSprites vs previousDisplayedSprites).
 * 
 * flush: 'post' ensures:
 * - DOM has been patched (spriteShellRefs are up-to-date)
 * - Runs before nextTick (before DOM lock unlock in applyFrame)
 * So bus entries are registered before phase FSM can advance.
 */
watch(
  () => controller.scene.renderedSprites.map(s => `${s.id}:${s.position}`).join('|'),
  (signature, prevSignature) => {
    if (!prevSignature) return; // Skip initial run
    if (signature === prevSignature) return; // No change
    controller.scene.trackSpritePositionTransitions(spriteShellRefs.value);
  },
  { flush: 'post' }
);

onUnmounted(() => {
  controller.scene.setBackgroundCameraElement(null);
  controller.scene.setSpriteCameraElement(null);
});
</script>

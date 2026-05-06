<template>
  <div 
    ref="sceneLayerRef"
    class="renpy-player__scene-layer" 
    :class="controller.scene.cameraAnimationClass"
  >
    <div
      v-if="controller.scene.isSceneTransitioning"
      class="renpy-player__scene-fade"
      :style="controller.scene.sceneFadeStyle"
    ></div>
    <SmartImage
      v-if="controller.scene.displayedBackground?.candidates?.length"
      ref="backgroundRef"
      class="renpy-player__background"
      :style="controller.scene.backgroundStyle"
      :candidates="controller.scene.displayedBackground.candidates"
      :alt="controller.scene.displayedBackground.description"
      @resolution-status="controller.diagnostics.onAssetResolutionStatus('__background__', $event)"
    />
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
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRenpyPlayer } from './player-context';
import SmartImage from './SmartImage.vue';

const controller = useRenpyPlayer();

// Element refs for camera transform tracking
const sceneLayerRef = ref<HTMLElement | null>(null);
const backgroundRef = ref<InstanceType<typeof SmartImage> | null>(null);
const spriteShellRefs = ref<HTMLElement[]>([]);

onMounted(() => {
  // Provide element references to controller for CSS transition tracking
  if (sceneLayerRef.value) {
    controller.scene.setCameraTransformElement(sceneLayerRef.value);
  }
  
  // SmartImage component wraps the actual img element, so we need to get the root element
  if (backgroundRef.value && backgroundRef.value.$el) {
    controller.scene.setBackgroundElement(backgroundRef.value.$el as HTMLElement);
  }
});

// Watch for sprite changes to track position transitions
// Only track when positions actually change, not on every render
watch(
  () => controller.scene.renderedSprites.map(s => ({ id: s.id, position: s.position })),
  (newPositions, oldPositions) => {
    // Skip initial render (no old positions)
    if (!oldPositions || oldPositions.length === 0) {
      return;
    }
    
    // Check if any sprite positions actually changed
    const positionsChanged = newPositions.some((newPos) => {
      const oldPos = oldPositions.find(p => p.id === newPos.id);
      // Position changed if sprite exists in both and position differs
      return oldPos && oldPos.position !== newPos.position;
    });
    
    if (positionsChanged) {
      // Wait for next tick to ensure DOM has updated with new positions
      setTimeout(() => {
        controller.scene.trackSpritePositionTransitions(spriteShellRefs.value);
      }, 0);
    }
  },
  { deep: true }
);

onUnmounted(() => {
  // Clean up element references
  controller.scene.setCameraTransformElement(null);
  controller.scene.setBackgroundElement(null);
});
</script>

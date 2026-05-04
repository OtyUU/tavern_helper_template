<template>
  <div class="renpy-player__scene-layer" :class="controller.scene.cameraAnimationClass">
    <div
      v-if="controller.scene.isSceneTransitioning"
      class="renpy-player__scene-fade"
      :style="controller.scene.sceneFadeStyle"
    ></div>
    <SmartImage
      v-if="controller.scene.displayedBackground?.candidates?.length"
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
import { useRenpyPlayer } from './player-context';
import SmartImage from './SmartImage.vue';

const controller = useRenpyPlayer();
</script>

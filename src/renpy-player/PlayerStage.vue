<template>
  <div class="renpy-player__stage-wrap" :style="controller.stage.stageWrapStyle">
    <div class="renpy-player__stage" :style="controller.stage.stageStyle" @click="controller.stage.onStageClick">
      <SceneLayer />
      <ViewportOverlay />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRenpyPlayer } from './player-context';
import SceneLayer from './SceneLayer.vue';
import ViewportOverlay from './ViewportOverlay.vue';

const controller = useRenpyPlayer();
</script>

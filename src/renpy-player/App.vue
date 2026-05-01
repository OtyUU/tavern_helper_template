<template>
  <section class="renpy-player">
    <PlayerStage />
  </section>
</template>

<script setup lang="ts">
import { renpyPlayerKey } from './player-context';
import { useRenpyPlayerController } from './useRenpyPlayerController';
import PlayerStage from './PlayerStage.vue';

const controller = useRenpyPlayerController();
provide(renpyPlayerKey, controller);
</script>

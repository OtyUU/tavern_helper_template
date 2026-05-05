<template>
  <details class="renpy-player__diagnostics" @click.stop>
    <summary @click.stop title="Diagnostics" aria-label="Diagnostics">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>
    </summary>
    <div class="renpy-player__diagnostics-grid">
      <p><strong>Source:</strong> {{ controller.model.parsedScript.source }}</p>
      <p><strong>Max message id:</strong> {{ controller.model.maxMessageId }}</p>
      <p><strong>Active message id:</strong> {{ controller.diagnostics.activeMessageId ?? 'none' }}</p>
      <p><strong>Playable messages:</strong> {{ controller.diagnostics.playableMessageCount }}
        <template v-if="controller.diagnostics.playableMessageRange">
          ({{ controller.diagnostics.playableMessageRange.first }}–{{ controller.diagnostics.playableMessageRange.last }})
        </template>
      </p>
      <p><strong>Prev playable id:</strong> {{ controller.diagnostics.prevPlayableId ?? 'none' }}</p>
      <p><strong>Next playable id:</strong> {{ controller.diagnostics.nextPlayableId ?? 'none' }}</p>
      <p><strong>Generation in progress:</strong> {{ controller.diagnostics.isGenerationInProgress }}</p>
      <p v-if="controller.diagnostics.generationTargetMessageId !== null">
        <strong>Generation target:</strong> {{ controller.diagnostics.generationTargetMessageId }}
      </p>
      <p><strong>Autoplay status:</strong> {{ controller.diagnostics.autoplayStatus }}</p>
      <p><strong>Cursor key:</strong> {{ controller.diagnostics.currentCursorKey }}</p>
      <p><strong>Camera:</strong> {{ controller.scene.cameraDiagnosticsLabel }}</p>
      <template v-for="sprite in controller.model.currentFrame?.sprites" :key="sprite.id">
        <p><strong>Sprite {{ sprite.id }}:</strong></p>
        <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
          <li>Reference height: {{ controller.diagnostics.getSpriteReferenceHeight(sprite.id) }}px</li>
          <li>Natural height (resolved): {{ controller.diagnostics.getSpriteNaturalHeight(sprite) }}px</li>
          <li>Normalization scale: {{ controller.diagnostics.getSpriteNormalizationScale(sprite).toFixed(4) }}</li>
          <template v-if="!sprite.asset?.candidates?.length">
            <li>No asset candidates</li>
          </template>
          <template v-else-if="spriteStatus(sprite.id)">
            <li v-if="spriteStatus(sprite.id)!.resolved" style="color:#8f8;">&#10003; {{ spriteStatus(sprite.id)!.resolved }}</li>
            <li v-else style="color:#f88;">Not resolved</li>
            <li v-for="f in spriteStatus(sprite.id)!.failed" :key="f" style="padding-left:1rem;color:#f88;">&#10007; {{ f }}</li>
          </template>
          <template v-else>
            <li style="color:#888;">Resolving&hellip;</li>
          </template>
        </ul>
      </template>
      <p v-if="!controller.model.currentFrame?.sprites?.length"><strong>Sprites:</strong> None</p>
      <p><strong>Background:</strong></p>
      <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
        <template v-if="!controller.model.currentFrame?.background?.candidates?.length">
          <li>None</li>
        </template>
        <template v-else-if="bgStatus">
          <li v-if="bgStatus.resolved" style="color:#8f8;">&#10003; {{ bgStatus.resolved }}</li>
          <li v-else style="color:#f88;">Not resolved</li>
          <li v-for="f in bgStatus.failed" :key="f" style="padding-left:1rem;color:#f88;">&#10007; {{ f }}</li>
        </template>
        <template v-else>
          <li style="color:#888;">Resolving&hellip;</li>
        </template>
      </ul>
      <p v-if="controller.diagnostics.characterSpriteConfigError"><strong>Character config JSON:</strong> {{ controller.diagnostics.characterSpriteConfigError }}</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRenpyPlayer } from './player-context';

const controller = useRenpyPlayer();

const bgStatus = computed(() => controller.diagnostics.assetResolutionStatus['__background__']);

function spriteStatus(id: string) {
  return controller.diagnostics.assetResolutionStatus[id];
}
</script>

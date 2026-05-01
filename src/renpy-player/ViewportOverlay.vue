<template>
  <div class="renpy-player__viewport">
    <div v-if="!controller.model.currentFrame" class="renpy-player__empty-state">
      <p>Select a chat message containing a Ren'Py-like block to preview it here.</p>
      <p>
        The parser currently understands <code>scene living_room night</code>, <code>show chinami base neutral</code>,
        say-with-attributes lines like <code>eileen happy "Hi"</code>, and dialogue lines like <code>c "Hi!!"</code>.
      </p>
    </div>
    <template v-else>
      <div class="renpy-player__hud-shell">
        <div class="renpy-player__dialogue-bar">
          <div class="renpy-player__speaker">{{ controller.dialogue.visibleSpeaker }}</div>
          <div class="renpy-player__text">{{ controller.dialogue.dialogueTextFull }}</div>
        </div>
        <div class="renpy-player__hud-rail" @click.stop>
          <div class="renpy-player__rail-row">
            <button
              class="renpy-player__hud-button"
              type="button"
              title="Restart"
              aria-label="Restart"
              :disabled="!controller.transport.canRestart"
              @click.stop="controller.transport.jumpToStart"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
            </button>
            <button
              class="renpy-player__hud-button"
              type="button"
              title="Previous"
              aria-label="Previous"
              :disabled="!controller.transport.canStepBack"
              @click.stop="controller.transport.stepBackward"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <button
              class="renpy-player__hud-button"
              type="button"
              title="Jump to latest script"
              aria-label="Jump to latest script"
              @click.stop="controller.selection.useLatestPlayable"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg>
            </button>
            <button
              class="renpy-player__hud-button"
              type="button"
              :title="controller.autoplay.isAutoplaying ? 'Pause' : 'Autoplay'"
              :aria-label="controller.autoplay.isAutoplaying ? 'Pause' : 'Autoplay'"
              :aria-pressed="controller.autoplay.isAutoplaying"
              :class="{ 'renpy-player__hud-button--active': controller.autoplay.isAutoplaying }"
              :disabled="!controller.autoplay.canToggleAutoplay"
              @click.stop="controller.autoplay.toggleAutoplay"
            >
              <svg v-if="controller.autoplay.isAutoplaying" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
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
                :disabled="!controller.selection.canSelectPreviousMessage"
                @click.stop="controller.selection.nudgeManualMessageId(-1)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 7.25h10v1.5H3z"/></svg>
              </button>
              <input
                :value="controller.selection.manualMessageId ?? ''"
                class="renpy-player__msg-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="off"
                @click.stop
                @input="controller.selection.onManualMessageInput"
                @change="controller.selection.applyManualMessageId"
                @blur="controller.selection.applyManualMessageId"
              />
              <button
                class="renpy-player__stepper-button"
                type="button"
                aria-label="Next message"
                :disabled="!controller.selection.canSelectNextMessage"
                @click.stop="controller.selection.nudgeManualMessageId(1)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z"/></svg>
              </button>
            </div>
            <div v-if="controller.model.hasFrames" class="renpy-player__frame-count">
              <strong>{{ controller.model.frameIndex + 1 }}/{{ controller.model.frames.length }}</strong>
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
        <p><strong>Source:</strong> {{ controller.model.parsedScript.source }}</p>
        <p><strong>Max message id:</strong> {{ controller.model.maxMessageId }}</p>
        <p><strong>Camera:</strong> {{ controller.scene.cameraDiagnosticsLabel }}</p>
        <template v-for="sprite in controller.model.currentFrame?.sprites" :key="sprite.id">
          <p><strong>Sprite {{ sprite.id }}:</strong></p>
          <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
            <li>Reference height: {{ controller.diagnostics.getSpriteReferenceHeight(sprite.id) }}px</li>
            <li>Natural height (resolved): {{ controller.diagnostics.getSpriteNaturalHeight(sprite) }}px</li>
            <li>Normalization scale: {{ controller.diagnostics.getSpriteNormalizationScale(sprite).toFixed(4) }}</li>
            <li v-if="sprite.asset?.candidates?.length">Candidates:</li>
            <li v-for="c in sprite.asset?.candidates" :key="c" style="padding-left:1rem;">{{ c }}</li>
            <li v-if="!sprite.asset?.candidates?.length">No asset candidates</li>
          </ul>
        </template>
        <p v-if="!controller.model.currentFrame?.sprites?.length"><strong>Sprites:</strong> None</p>
        <p><strong>Background candidates:</strong></p>
        <ul style="margin:0; padding-left:1rem; font-size:0.75rem;">
          <li v-for="c in controller.model.currentFrame?.background?.candidates" :key="c">{{ c }}</li>
          <li v-if="!controller.model.currentFrame?.background?.candidates?.length">None</li>
        </ul>
        <p v-if="controller.diagnostics.characterSpriteConfigError"><strong>Character config JSON:</strong> {{ controller.diagnostics.characterSpriteConfigError }}</p>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { useRenpyPlayer } from './player-context';

const controller = useRenpyPlayer();
</script>

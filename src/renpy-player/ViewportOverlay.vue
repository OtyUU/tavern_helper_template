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
      <div
        class="renpy-player__hud-shell"
        :class="controller.scene.isHudHidden
          ? 'renpy-player__hud-shell--hidden'
          : 'renpy-player__hud-shell--visible'"
      >
        <div class="renpy-player__dialogue-bar">
          <div
            class="renpy-player__speaker"
            :class="controller.dialogue.speakerRevealed ? 'renpy-player__speaker--visible' : 'renpy-player__speaker--hidden'"
          >{{ controller.dialogue.displayedSpeaker }}</div>
          <!-- Key must be based on the *active* cursor, not the user's in-progress input.
               Otherwise typing into the message-id box can remount this block and restart reveal. -->
          <div
            class="renpy-player__text"
            :key="`${controller.diagnostics.activeMessageId ?? 'none'}:${controller.model.currentFrame?.index ?? 'none'}`"
          ><span
            v-for="(grapheme, i) in controller.dialogue.graphemes"
            :key="i"
            class="renpy-player__char"
            :class="i < controller.dialogue.revealedCharCount ? 'renpy-player__char--visible' : 'renpy-player__char--hidden'"
          >{{ grapheme }}</span></div>
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
                @keydown.enter.prevent="controller.selection.applyManualMessageId"
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
    <DiagnosticsPanel />
  </div>
</template>

<script setup lang="ts">
import { useRenpyPlayer } from './player-context';
import DiagnosticsPanel from './DiagnosticsPanel.vue';

const controller = useRenpyPlayer();
</script>

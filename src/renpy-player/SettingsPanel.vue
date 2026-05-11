<template>
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>VN Player</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>

    <div class="inline-drawer-content">
      <!-- Camera presets - always on top, open by default -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.camera }"
          @click="accordionState.camera = !accordionState.camera"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Camera presets</h4>
        </div>
        <div v-show="accordionState.camera" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Adjust framing for the default view plus the Ren'Py-style <code>medium</code> and <code>closeup</code> transforms.
          </p>

          <div class="renpy-player-settings__field">
            <label>Stage height (px)</label>
            <div class="renpy-player-settings__height-control">
              <input v-model.number="settings.stageHeight" class="text_pole" type="number" min="200" max="1200" step="10" />
              <div class="renpy-player-settings__height-presets">
                <button 
                  type="button"
                  class="renpy-player-settings__preset-btn"
                  :class="{ 'is-active': settings.stageHeight === 500 }"
                  @click="settings.stageHeight = 500"
                >
                  500
                </button>
                <button 
                  type="button"
                  class="renpy-player-settings__preset-btn"
                  :class="{ 'is-active': settings.stageHeight === 720 }"
                  @click="settings.stageHeight = 720"
                >
                  720
                </button>
              </div>
            </div>
            <small>The VN viewport height.</small>
          </div>

          <div class="renpy-player-settings__grid">
            <div class="renpy-player-settings__field">
              <label>Background parallax X (0..1)</label>
              <input v-model.number="settings.bgPanParallax" class="text_pole" type="number" min="0" max="1" step="0.05" />
              <small>Horizontal pan parallax. Lower = stronger depth effect (bg moves slower).</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Background parallax Y (0..1)</label>
              <input v-model.number="settings.bgPanParallaxY" class="text_pole" type="number" min="0" max="1" step="0.05" />
              <small>Vertical pan parallax. Lower = stronger depth effect (bg moves slower).</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Background zoom parallax (0..1)</label>
              <input v-model.number="settings.bgZoomParallax" class="text_pole" type="number" min="0" max="1" step="0.05" />
              <small>Zoom parallax. Lower = bg zooms less than sprites (stronger depth).</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Auto-pan sensitivity (0..1)</label>
              <input v-model.number="settings.autoPanSensitivity" class="text_pole" type="number" min="0" max="1" step="0.05" />
              <small>How strongly the camera auto-centers sprites. 0 = disabled, 1 = full centering.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Sprite center X (%)</label>
              <input v-model.number="settings.spriteCenterX" class="text_pole" type="number" min="0" max="100" step="1" />
              <small>Default anchor for sprites without an explicit stage position.</small>
            </div>
          </div>

          <div class="renpy-player-settings__grid renpy-player-settings__grid--spacing">
            <div class="renpy-player-settings__field">
              <label>Left/right spacing (%)</label>
              <input v-model.number="settings.spriteSideSpacing" class="text_pole" type="number" min="0" max="50" step="1" />
              <small>
                Offset for <code>left</code> and <code>right</code> slots from the center anchor.
              </small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Mid spacing (%)</label>
              <input v-model.number="settings.spriteMidSpacing" class="text_pole" type="number" min="0" max="60" step="1" />
              <small>Offset for <code>midleft</code> and <code>midright</code> slots.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Far spacing (%)</label>
              <input v-model.number="settings.spriteFarSpacing" class="text_pole" type="number" min="0" max="60" step="1" />
              <small>Offset for <code>farleft</code> and <code>farright</code> slots.</small>
            </div>
          </div>

          <div class="renpy-player-settings__camera-grid">
            <div class="renpy-player-settings__camera-card">
              <h5>Default</h5>
              <div class="renpy-player-settings__field">
                <label>Camera scale</label>
                <input v-model.number="cameraScaleDefault" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
                <small>Scales both background and sprites together.</small>
              </div>
              <div class="renpy-player-settings__field">
                <label>Camera pan Y (%)</label>
                <input v-model.number="settings.defaultSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
              </div>
            </div>

            <div class="renpy-player-settings__camera-card">
              <h5>Medium</h5>
              <div class="renpy-player-settings__field">
                <label>Camera scale</label>
                <input v-model.number="cameraScaleMedium" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
                <small>Scales both background and sprites together.</small>
              </div>
              <div class="renpy-player-settings__field">
                <label>Camera pan Y (%)</label>
                <input v-model.number="settings.mediumSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
              </div>
            </div>

            <div class="renpy-player-settings__camera-card">
              <h5>Closeup</h5>
              <div class="renpy-player-settings__field">
                <label>Camera scale</label>
                <input v-model.number="cameraScaleCloseup" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
                <small>Scales both background and sprites together.</small>
              </div>
              <div class="renpy-player-settings__field">
                <label>Camera pan Y (%)</label>
                <input v-model.number="settings.closeupSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Animations - often used -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.animations }"
          @click="accordionState.animations = !accordionState.animations"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Animations</h4>
        </div>
        <div v-show="accordionState.animations" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Control camera movement and how quickly sprite changes dissolve.
          </p>

          <div class="renpy-player-settings__grid">
            <div class="renpy-player-settings__field">
              <label>Camera transition (ms)</label>
              <input v-model.number="settings.cameraTransitionMs" class="text_pole" type="number" min="0" max="5000" step="10" />
              <small>Used for <code>closeup</code>, <code>medium</code>, and return-to-default camera movement.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Scene transition (ms)</label>
              <input v-model.number="settings.sceneTransitionMs" class="text_pole" type="number" min="0" max="2000" step="50" />
              <small>Fade-to-black duration when changing scenes with <code>scene</code> command.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Expression change (ms)</label>
              <input v-model.number="settings.expressionChangeMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Short crossfade for expression or blush-only sprite changes.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Pose change (ms)</label>
              <input v-model.number="settings.poseChangeMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Faster dissolve for big silhouette changes like new poses or outfits.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Sprite enter (ms)</label>
              <input v-model.number="settings.spriteEnterMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Fade-in duration when a character first appears.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Sprite exit (ms)</label>
              <input v-model.number="settings.spriteExitMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Fade-out duration when a character is hidden or cleared.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Visibility effect</label>
              <CustomSelect
                v-model="settings.spriteVisibilityEffect"
                :options="[{ value: 'fade', label: 'fade' }, { value: 'none', label: 'none' }]"
              />
              <small>Use <code>none</code> for instant sprite show/hide.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>HUD hide scope</label>
              <CustomSelect
                v-model="settings.hudHideScope"
                :options="[{ value: 'scene-only', label: 'Scene only' }, { value: 'all-motion', label: 'All motion' }]"
              />
              <small>Hide HUD during scene crossfade only, or during any visual motion.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>HUD hide duration (ms)</label>
              <input v-model.number="settings.hudHideDurationMs" class="text_pole" type="number" min="0" max="1000" step="10" />
            </div>

            <div class="renpy-player-settings__field">
              <label>HUD show duration (ms)</label>
              <input v-model.number="settings.hudShowDurationMs" class="text_pole" type="number" min="0" max="1000" step="10" />
            </div>

            <div class="renpy-player-settings__field">
              <label>HUD drift distance (px)</label>
              <input v-model.number="settings.hudHideDriftPx" class="text_pole" type="number" min="0" max="60" step="1" />
            </div>
          </div>
        </div>
      </section>

      <!-- Character layouts - often used -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.characters }"
          @click="accordionState.characters = !accordionState.characters"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Character layouts</h4>
        </div>
        <div v-show="accordionState.characters" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Configure per-character default outfits, normalization height, and pose tokens.
            Global defaults apply when a character is not in the config.
          </p>

          <div class="renpy-player-settings__field">
            <label>Sprite reference height (px)</label>
            <input
              v-model.number="settings.spriteReferenceHeight"
              class="text_pole"
              type="number"
              min="500"
              max="4000"
              step="50"
            />
            <small>
              Default canvas height for sprite normalization.
              Characters without a specific <code>referenceHeight</code> will use this value.
              This is the baseline canvas height for a character pack.
              Taller source canvases render proportionally taller from the bottom anchor.
            </small>
          </div>

          <div class="renpy-player-settings__field">
            <label>Sprite baseline offset (px)</label>
            <input
              v-model.number="settings.spriteBaselineOffsetPx"
              class="text_pole"
              type="number"
              min="-2000"
              max="2000"
              step="10"
            />
            <small>Moves all sprites up/down to account for transparent canvas padding. Positive = down.</small>
          </div>

          <div class="renpy-player-settings__field">
            <label>Character sprite config JSON</label>
            <textarea
              v-model="settings.characterSpriteConfig"
              class="text_pole"
              rows="6"
              :placeholder='charConfigPlaceholder'
            ></textarea>
            <small>
              Each key is a character name (keys starting with "_" are ignored and can be used for comments).
              <code>defaultOutfit</code>: outfit used when <code>show</code> omits <code>in &lt;outfit&gt;</code> and no previous outfit is remembered.
              <code>referenceHeight</code>: baseline canvas height for this character&apos;s sprite pack.
              Taller canvases render proportionally taller from the same bottom anchor.
              <code>poseTokens</code>: list of tokens that identify a pose.
              Extra JSON fields are ignored, so old offset metadata can remain in source configs without affecting runtime.
            </small>
            <small v-if="characterSpriteConfigError" class="renpy-player-settings__error">{{ characterSpriteConfigError }}</small>
          </div>

          <div class="renpy-player-settings__grid">
            <div class="renpy-player-settings__field">
              <label>Default pose token</label>
              <input v-model="settings.defaultPose" class="text_pole" type="text" placeholder="base" />
            </div>

            <div class="renpy-player-settings__field">
              <label>Default expression token</label>
              <input v-model="settings.defaultExpression" class="text_pole" type="text" placeholder="neutral" />
            </div>
          </div>

          <div class="renpy-player-settings__field">
            <label>Global pose tokens (comma-separated)</label>
            <input v-model="settings.globalPoseTokens" class="text_pole" type="text" placeholder="base,burst,lean,sit,stand" />
            <small>
              Tokens that identify a pose (vs expression) when a <code>show</code> command has only one remaining token.
              Per-character <code>poseTokens</code> in the config above takes precedence.
            </small>
          </div>
        </div>
      </section>

      <!-- Playback - medium usage -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.playback }"
          @click="accordionState.playback = !accordionState.playback"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Playback</h4>
        </div>
        <div v-show="accordionState.playback" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Basic player behavior and message selection.
          </p>

          <div class="renpy-player-settings__field renpy-player-settings__checkbox">
            <input v-model="settings.followLatestPlayable" type="checkbox" />
            <label>Follow the latest playable chat message automatically</label>
          </div>
        </div>
      </section>

      <!-- Dialogue Reveal - rarely used, collapsed by default -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.dialogue }"
          @click="accordionState.dialogue = !accordionState.dialogue"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Dialogue Reveal</h4>
        </div>
        <div v-show="accordionState.dialogue" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Fine-tune the VN-style typewriter effect and speaker intro animation.
          </p>

          <div class="renpy-player-settings__grid">
            <div class="renpy-player-settings__field">
              <label>Text speed (ms)</label>
              <input v-model.number="settings.textSpeedMs" class="text_pole" type="number" min="0" max="500" step="5" />
              <small>Delay between each grapheme. 0 = instant.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Text fade (ms)</label>
              <input v-model.number="settings.textFadeMs" class="text_pole" type="number" min="0" max="1000" step="10" />
              <small>Per-character opacity transition duration.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Sentence pause (ms)</label>
              <input v-model.number="settings.sentencePauseMs" class="text_pole" type="number" min="0" max="5000" step="50" />
              <small>Extra delay after <code>. ! ? … 。 ！ ？</code></small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Comma pause (ms)</label>
              <input v-model.number="settings.commaPauseMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Extra delay after <code>, ; : — 、 ； ：</code></small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Speaker fade (ms)</label>
              <input v-model.number="settings.speakerFadeMs" class="text_pole" type="number" min="0" max="2000" step="10" />
              <small>Speaker name opacity transition when the speaker changes.</small>
            </div>

            <div class="renpy-player-settings__field">
              <label>Auto-advance delay (ms)</label>
              <input v-model.number="settings.autoAdvanceDelayMs" class="text_pole" type="number" min="0" max="30000" step="100" />
              <small>Wait after reveal finishes before autoplay advances. 0 = immediate.</small>
            </div>
          </div>
        </div>
      </section>

      <!-- Assets - rarely used, collapsed by default -->
      <section class="renpy-player-settings__accordion">
        <div 
          class="renpy-player-settings__accordion-header"
          :class="{ 'is-open': accordionState.assets }"
          @click="accordionState.assets = !accordionState.assets"
        >
          <i class="fa-solid fa-chevron-right renpy-player-settings__accordion-icon"></i>
          <h4>Assets</h4>
        </div>
        <div v-show="accordionState.assets" class="renpy-player-settings__accordion-content">
          <p class="renpy-player-settings__section-description">
            Where the player should load sprite and background files from.
          </p>

          <div class="renpy-player-settings__field">
            <label>Asset root URL/path</label>
            <input v-model="settings.assetRoot" class="text_pole" type="text" placeholder="https://example.com/assets" />
            <small>Sprites: <code>{{ spritePathExample }}</code></small>
            <small>Backgrounds: <code>{{ backgroundPathExample }}</code></small>
          </div>

          <div class="renpy-player-settings__grid">
            <div class="renpy-player-settings__field">
              <label>Asset extensions</label>
              <input v-model="settings.assetExtensions" class="text_pole" type="text" placeholder="png,jpg,webp" />
              <small>File extensions to use for both sprites and backgrounds.</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useRenpyPlayerSettingsStore } from './settings';
import CustomSelect from './CustomSelect.vue';

const store = useRenpyPlayerSettingsStore();
const { settings, characterSpriteConfigError } = storeToRefs(store);

// Accordion state - camera open by default, others closed
const accordionState = reactive({
  camera: true,
  animations: true,
  characters: true,
  playback: false,
  dialogue: false,
  assets: false,
});

const spritePathExample = computed(
  () => `${settings.value.assetRoot || '[asset root]'}/chinami/maid_uniform/base/averted.png`,
);
const backgroundPathExample = computed(
  () => `${settings.value.assetRoot || '[asset root]'}/bg/chinami_room-day.png`,
);

const charConfigPlaceholder = JSON.stringify(
  {
    _magical_academy: 'Reference: 2000px',
    chinami: {
      defaultOutfit: 'pajamas',
      poseTokens: ['base', 'burst', 'lean'],
      referenceHeight: 2000,
    },
  },
  null,
  2,
);

// Unified camera scale controls that sync both background and sprite scales
const cameraScaleDefault = computed({
  get: () => settings.value.defaultBackgroundScale,
  set: (value: number) => {
    settings.value.defaultBackgroundScale = value;
    settings.value.defaultSpriteScale = value;
  },
});

const cameraScaleMedium = computed({
  get: () => settings.value.mediumBackgroundScale,
  set: (value: number) => {
    settings.value.mediumBackgroundScale = value;
    settings.value.mediumSpriteScale = value;
  },
});

const cameraScaleCloseup = computed({
  get: () => settings.value.closeupBackgroundScale,
  set: (value: number) => {
    settings.value.closeupBackgroundScale = value;
    settings.value.closeupSpriteScale = value;
  },
});
</script>

<style scoped lang="scss">
.renpy-player-settings__accordion {
  margin-bottom: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 32%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 12%, transparent);
  overflow: hidden;
}

.renpy-player-settings__accordion-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 0.95rem;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 20%, transparent);
  }

  h4 {
    margin: 0;
    font-size: 1.05em;
  }
}

.renpy-player-settings__accordion-icon {
  font-size: 0.85em;
  transition: transform 0.2s ease;
  opacity: 0.7;

  .is-open & {
    transform: rotate(90deg);
  }
}

.renpy-player-settings__accordion-content {
  padding: 0 0.95rem 0.95rem 0.95rem;
}

.renpy-player-settings__section-description {
  margin: 0 0 0.9rem 0;
  opacity: 0.8;
  font-size: 0.95em;
}

.renpy-player-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.8rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.renpy-player-settings__grid--spacing {
  grid-template-columns: repeat(3, 1fr);
  margin-top: 0.8rem;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.renpy-player-settings__camera-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.8rem;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.renpy-player-settings__camera-card {
  padding: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 24%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--black30a) 22%, transparent);
}

.renpy-player-settings__camera-card h5 {
  margin: 0 0 0.6rem 0;
}

.renpy-player-settings__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
}

.renpy-player-settings__camera-card .renpy-player-settings__field:last-child,
.renpy-player-settings__accordion-content > .renpy-player-settings__field:last-child,
.renpy-player-settings__accordion-content > .renpy-player-settings__grid:last-child {
  margin-bottom: 0;
}

.renpy-player-settings__field textarea {
  min-height: 5rem;
  resize: vertical;
}

.renpy-player-settings__checkbox {
  flex-direction: row;
  align-items: center;
}

.renpy-player-settings__field small {
  opacity: 0.8;
}

.renpy-player-settings__error {
  color: #ff8888;
}

.renpy-player-settings__height-control {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}

.renpy-player-settings__height-presets {
  display: flex;
  gap: 0.4rem;
}

.renpy-player-settings__preset-btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 40%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 8%, transparent);
  color: var(--SmartThemeBodyColor);
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 18%, transparent);
    border-color: color-mix(in srgb, var(--SmartThemeBorderColor) 60%, transparent);
  }

  &.is-active {
    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 30%, transparent);
    border-color: var(--SmartThemeQuoteColor);
    font-weight: 600;
  }
}
</style>

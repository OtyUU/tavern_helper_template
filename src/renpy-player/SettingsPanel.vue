<template>
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>VN Player</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>

    <div class="inline-drawer-content">
      <section class="renpy-player-settings__section">
        <div class="renpy-player-settings__section-header">
          <h4>Assets</h4>
          <p>Where the player should load sprite and background files from.</p>
        </div>

        <div class="renpy-player-settings__field">
          <label>Sprite root URL/path</label>
          <input v-model="settings.spriteRoot" class="text_pole" type="text" placeholder="https://example.com/assets" />
          <small>Sprites are resolved like <code>{{ spritePathExample }}</code>.</small>
        </div>

        <div class="renpy-player-settings__field">
          <label>Background root URL/path</label>
          <input
            v-model="settings.backgroundRoot"
            class="text_pole"
            type="text"
            placeholder="https://example.com/backgrounds"
          />
          <small>Backgrounds are resolved like <code>{{ backgroundPathExample }}</code>.</small>
        </div>

        <div class="renpy-player-settings__grid">
          <div class="renpy-player-settings__field">
            <label>Asset extensions</label>
            <input v-model="settings.assetExtensions" class="text_pole" type="text" placeholder="png,jpg,webp" />
            <small>File extensions to use for both sprites and backgrounds.</small>
          </div>
        </div>
      </section>

      <section class="renpy-player-settings__section">
        <div class="renpy-player-settings__section-header">
          <h4>Playback</h4>
          <p>Basic player behavior and message selection.</p>
        </div>

        <div class="renpy-player-settings__grid">
          <div class="renpy-player-settings__field">
            <label>Stage height (px)</label>
            <input v-model.number="settings.stageHeight" class="text_pole" type="number" min="200" max="1200" step="10" />
            <small>The VN viewport height. Bleed background shows when the panel is wider than height x 16/9.</small>
          </div>

          <div class="renpy-player-settings__field">
            <label>Autoplay delay (ms)</label>
            <input v-model.number="settings.autoPlayDelayMs" class="text_pole" type="number" min="500" max="20000" step="100" />
          </div>
        </div>

        <div class="renpy-player-settings__field renpy-player-settings__checkbox">
          <input v-model="settings.followLatestPlayable" type="checkbox" />
          <label>Follow the latest playable chat message automatically</label>
        </div>
      </section>

      <section class="renpy-player-settings__section">
        <div class="renpy-player-settings__section-header">
          <h4>Animations</h4>
          <p>Control camera movement and how quickly sprite changes dissolve.</p>
        </div>

        <div class="renpy-player-settings__grid">
          <div class="renpy-player-settings__field">
            <label>Camera transition (ms)</label>
            <input v-model.number="settings.cameraTransitionMs" class="text_pole" type="number" min="0" max="5000" step="10" />
            <small>Used for <code>closeup</code>, <code>medium</code>, and return-to-default camera movement.</small>
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
        </div>
      </section>

      <section class="renpy-player-settings__section">
        <div class="renpy-player-settings__section-header">
          <h4>Camera presets</h4>
          <p>Adjust framing for the default view plus the Ren'Py-style <code>medium</code> and <code>closeup</code> transforms.</p>
        </div>

        <div class="renpy-player-settings__camera-grid">
          <div class="renpy-player-settings__camera-card">
            <h5>Default</h5>
            <div class="renpy-player-settings__field">
              <label>Background scale</label>
              <input v-model.number="settings.defaultBackgroundScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite scale</label>
              <input v-model.number="settings.defaultSpriteScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite offset Y (%)</label>
              <input v-model.number="settings.defaultSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite center X (%)</label>
              <input v-model.number="settings.spriteCenterX" class="text_pole" type="number" min="0" max="100" step="1" />
              <small>Default anchor for sprites without an explicit stage position.</small>
            </div>
            <div class="renpy-player-settings__field">
              <label>Left/right spacing (%)</label>
              <input v-model.number="settings.spriteSideSpacing" class="text_pole" type="number" min="0" max="50" step="1" />
              <small>
                Controls how far <code>left</code> and <code>right</code> sit from the center anchor.
              </small>
            </div>
          </div>

          <div class="renpy-player-settings__camera-card">
            <h5>Medium</h5>
            <div class="renpy-player-settings__field">
              <label>Background scale</label>
              <input v-model.number="settings.mediumBackgroundScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite scale</label>
              <input v-model.number="settings.mediumSpriteScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite offset Y (%)</label>
              <input v-model.number="settings.mediumSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
            </div>
          </div>

          <div class="renpy-player-settings__camera-card">
            <h5>Closeup</h5>
            <div class="renpy-player-settings__field">
              <label>Background scale</label>
              <input v-model.number="settings.closeupBackgroundScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite scale</label>
              <input v-model.number="settings.closeupSpriteScale" class="text_pole" type="number" min="0.5" max="3.0" step="0.1" />
            </div>
            <div class="renpy-player-settings__field">
              <label>Sprite offset Y (%)</label>
              <input v-model.number="settings.closeupSpriteY" class="text_pole" type="number" min="-100" max="100" step="1" />
            </div>
          </div>
        </div>
      </section>

      <section class="renpy-player-settings__section">
        <div class="renpy-player-settings__section-header">
          <h4>Character layouts</h4>
          <p>
            Configure per-character sprite layout, default outfit, and pose tokens.
            Global defaults apply when a character is not in the config.
          </p>
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
            Each key is a character name. <code>layout</code>: <code>outfit_pose</code> (default) or <code>flat</code>.
            <code>poseTokens</code>: list of tokens that identify a pose (e.g. <code>["base","burst"]</code>).
          </small>
          <small v-if="characterSpriteConfigError" class="renpy-player-settings__error">{{ characterSpriteConfigError }}</small>
        </div>

        <div class="renpy-player-settings__grid">
          <div class="renpy-player-settings__field">
            <label>Default sprite layout</label>
            <select v-model="settings.defaultSpriteLayout" class="text_pole">
              <option value="outfit_pose">outfit_pose</option>
              <option value="flat">flat</option>
            </select>
            <small>Fallback for characters not in the config above.</small>
          </div>

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
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useRenpyPlayerSettingsStore } from './settings';

const store = useRenpyPlayerSettingsStore();
const { settings, characterSpriteConfigError } = storeToRefs(store);

const spritePathExample = computed(
  () => `${settings.value.spriteRoot || '[sprite root]'}/chinami/pajamas/base/annoyed.png`,
);
const backgroundPathExample = computed(
  () => `${settings.value.backgroundRoot || '[background root]'}/protagonist_room-day.png`,
);

const charConfigPlaceholder = JSON.stringify(
  {
    chinami: { layout: 'outfit_pose', defaultOutfit: 'pajamas', poseTokens: ['base', 'burst', 'lean'] },
    teacher_npc: { layout: 'flat' },
  },
  null,
  2,
);
</script>

<style scoped lang="scss">
.renpy-player-settings__section {
  margin-bottom: 1rem;
  padding: 0.95rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 32%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 12%, transparent);
}

.renpy-player-settings__section-header {
  margin-bottom: 0.9rem;
}

.renpy-player-settings__section-header h4,
.renpy-player-settings__camera-card h5 {
  margin: 0;
}

.renpy-player-settings__section-header p {
  margin: 0.25rem 0 0;
  opacity: 0.8;
}

.renpy-player-settings__grid,
.renpy-player-settings__camera-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.8rem;
}

.renpy-player-settings__camera-card {
  padding: 0.8rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 24%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--black30a) 22%, transparent);
}

.renpy-player-settings__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
}

.renpy-player-settings__camera-card .renpy-player-settings__field:last-child,
.renpy-player-settings__section > .renpy-player-settings__field:last-child {
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
</style>

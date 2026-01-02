<template>
  <div class="kinako-panel">
    <div class="info-section">
      <h3 class="section-title">🐱 Current Status</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Mood:</span>
          <span class="info-value mood-badge" :data-mood="data.kinako.mood">{{ mood_display }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Energy:</span>
          <span class="info-value">{{ data.kinako.energy_level }}/100</span>
        </div>
        <div class="info-item full-width">
          <span class="info-label">Activity:</span>
          <span class="info-value">{{ data.kinako.current_activity }}</span>
        </div>
      </div>
    </div>

    <div v-if="!_.isEmpty(data.kinako.outfit)" class="info-section">
      <h3 class="section-title">👗 Current Outfit</h3>
      <div class="outfit-list">
        <div v-for="(desc, part) in data.kinako.outfit" :key="part" class="outfit-item">
          <span class="outfit-part">{{ format_part(part) }}:</span>
          <span class="outfit-desc">{{ desc }}</span>
        </div>
      </div>
    </div>

    <div v-if="!_.isEmpty(data.kinako.favorite_things)" class="info-section">
      <h3 class="section-title">⭐ Favorite Things</h3>
      <div class="favorites-list">
        <div v-for="(item, name) in data.kinako.favorite_things" :key="name" class="favorite-item">
          <div class="favorite-header">
            <span class="favorite-name">{{ name }}</span>
            <span class="favorite-interest">
              {{ '⭐'.repeat(item.interest_level) }}
            </span>
          </div>
          <div class="favorite-desc">{{ item.description }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../store';

const { data } = useDataStore();

const mood_display = computed(() => {
  return data.value.kinako.mood
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
});

const format_part = (part: string) => {
  return part.charAt(0).toUpperCase() + part.slice(1);
};
</script>

<style lang="scss" scoped>
.kinako-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-section {
  background: white;
  border: 2px solid var(--c-kinako-gold);
  border-radius: 8px;
  padding: 12px;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--c-kinako-teal);
  border-bottom: 2px solid var(--c-kinako-gold);
  padding-bottom: 6px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;

  &.full-width {
    grid-column: 1 / -1;
  }
}

.info-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--c-kinako-teal);
}

.info-value {
  font-size: 14px;
  color: var(--c-kinako-dark);
}

.mood-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 16px;
  font-weight: 600;
  background: var(--c-kinako-gold);
  width: fit-content;

  &[data-mood='happy'] {
    background: #ffeb3b;
  }
  &[data-mood='playful'] {
    background: #ff9800;
  }
  &[data-mood='pouty'] {
    background: #ffb6c1;
  }
  &[data-mood='sleepy'] {
    background: #b0bec5;
  }
  &[data-mood='curious'] {
    background: #64b5f6;
  }
  &[data-mood='tantrum'] {
    background: #ef5350;
  }
  &[data-mood='clingy'] {
    background: #f48fb1;
  }
}

.outfit-list,
.favorites-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.outfit-item {
  display: flex;
  gap: 8px;
  font-size: 14px;
}

.outfit-part {
  font-weight: 600;
  color: var(--c-kinako-teal);
  min-width: 90px;
}

.outfit-desc {
  color: var(--c-kinako-dark);
}

.favorite-item {
  padding: 10px;
  background: var(--c-kinako-cream);
  border-left: 3px solid var(--c-kinako-gold);
  border-radius: 4px;
}

.favorite-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.favorite-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--c-kinako-dark);
}

.favorite-interest {
  font-size: 12px;
}

.favorite-desc {
  font-size: 13px;
  color: #666;
  line-height: 1.4;
}
</style>

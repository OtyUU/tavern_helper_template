<template>
  <div class="world-section">
    <div class="world-row">
      <span class="label">🕐 Time:</span>
      <span class="value">{{ data.world.current_time }}</span>
    </div>
    <div class="world-row">
      <span class="label">📍 Location:</span>
      <span class="value">{{ data.world.current_location }}</span>
    </div>
    <div class="world-row">
      <span class="label">☀️ Weather:</span>
      <span class="value">{{ data.world.weather }}</span>
    </div>
    <div v-if="!_.isEmpty(data.world.recent_events)" class="events-section">
      <div class="label">📋 Recent Events:</div>
      <div class="events-list">
        <div v-for="(desc, name) in data.world.recent_events" :key="name" class="event-item">
          <strong>{{ name }}:</strong> {{ desc }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../store';

const { data } = useDataStore();
</script>

<style lang="scss" scoped>
.world-section {
  padding: 12px 16px;
  background: rgba(94, 179, 179, 0.1);
  border-bottom: 2px solid var(--c-kinako-teal);
}

.world-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;

  &:last-child {
    margin-bottom: 0;
  }
}

.label {
  font-weight: 600;
  color: var(--c-kinako-teal);
  min-width: 100px;
}

.value {
  color: var(--c-kinako-dark);
}

.events-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(94, 179, 179, 0.3);
}

.events-list {
  margin-top: 6px;
  padding-left: 12px;
}

.event-item {
  font-size: 13px;
  margin-bottom: 4px;
  color: var(--c-kinako-dark);

  strong {
    color: var(--c-kinako-teal);
  }
}
</style>

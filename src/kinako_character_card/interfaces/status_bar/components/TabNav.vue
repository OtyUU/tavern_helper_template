<template>
  <div class="tab-nav">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-button"
      :class="{ active: modelValue === tab.id }"
      @click="$emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  tabs: Array<{ id: string; label: string }>;
  modelValue: string | null;
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<style lang="scss" scoped>
.tab-nav {
  display: flex;
  background: var(--c-kinako-gold);
  border-bottom: 2px solid var(--c-kinako-dark);
}

.tab-button {
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-right: 1px solid rgba(60, 73, 80, 0.2);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-kinako-dark);
  cursor: pointer;
  transition: all 0.3s ease;

  &:last-child {
    border-right: none;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  &.active {
    background: var(--c-kinako-cream);
    color: var(--c-kinako-teal);
    font-weight: 700;
  }
}
</style>

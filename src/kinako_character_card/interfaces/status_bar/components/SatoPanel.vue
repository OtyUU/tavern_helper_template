<template>
  <div class="sato-panel">
    <div v-if="!_.isEmpty(data.sato.inventory)" class="info-section">
      <h3 class="section-title">🎒 Inventory</h3>
      <div class="inventory-list">
        <div v-for="(item, name) in data.sato.inventory" :key="name" class="inventory-item">
          <div class="item-header">
            <span class="item-name">{{ name }}</span>
            <span class="item-quantity">×{{ item.quantity }}</span>
          </div>
          <div class="item-desc">{{ item.description }}</div>
        </div>
      </div>
    </div>

    <div v-if="!_.isEmpty(data.sato.kinako_gifts_received)" class="info-section">
      <h3 class="section-title">🎁 Gifts from Kinako</h3>
      <div class="gifts-list">
        <div v-for="(when_received, gift_name) in data.sato.kinako_gifts_received" :key="gift_name" class="gift-item">
          <div class="gift-name">{{ gift_name }}</div>
          <div class="gift-time">Received: {{ when_received }}</div>
        </div>
      </div>
    </div>

    <div v-if="data.sato.relationship_notes" class="info-section">
      <h3 class="section-title">📝 Relationship Notes</h3>
      <div class="notes-content">{{ data.sato.relationship_notes }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from '../store';

const { data } = useDataStore();
</script>

<style lang="scss" scoped>
.sato-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-section {
  background: white;
  border: 2px solid var(--c-kinako-teal);
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

.inventory-list,
.gifts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inventory-item {
  padding: 10px;
  background: linear-gradient(135deg, #f0f8ff 0%, #e6f7ff 100%);
  border-left: 4px solid var(--c-kinako-teal);
  border-radius: 4px;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.item-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--c-kinako-dark);
}

.item-quantity {
  font-weight: 600;
  font-size: 14px;
  color: var(--c-kinako-teal);
  background: white;
  padding: 2px 8px;
  border-radius: 12px;
}

.item-desc {
  font-size: 13px;
  color: #555;
  line-height: 1.4;
}

.gift-item {
  padding: 8px 12px;
  background: var(--c-kinako-cream);
  border-radius: 6px;
  border: 1px solid var(--c-kinako-gold);
}

.gift-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--c-kinako-dark);
  margin-bottom: 4px;
}

.gift-time {
  font-size: 12px;
  color: #777;
  font-style: italic;
}

.notes-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-kinako-dark);
  white-space: pre-wrap;
  background: var(--c-kinako-cream);
  padding: 12px;
  border-radius: 6px;
  border: 1px dashed var(--c-kinako-gold);
}
</style>

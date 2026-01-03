import { defineMvuDataStore } from '@/util/mvu';
import { Schema } from '../../schema';

// Note: The schema requires certain fields, so we need to provide defaults
// We can't rely on the additional_setup callback because the initial parse will fail on empty data
// Instead, we'll wrap the schema with proper defaults
const SchemaWithDefaults = Schema.catch(() => ({
  world: {
    current_time: new Date()
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-'),
    current_location: 'Unknown',
    weather: 'Sunny',
    recent_events: {},
  },
  kinako: {
    affection: 50,
    mood: 'playful' as const,
    energy_level: 80,
    outfit: {},
    current_activity: 'Playing',
    favorite_things: {},
    $affection_stage: 'attached' as const,
  },
  sato: {
    inventory: {},
    kinako_gifts_received: {},
    relationship_notes: '',
  },
}));

export const useDataStore = defineMvuDataStore(SchemaWithDefaults, {
  type: 'message',
  message_id: getCurrentMessageId(),
});

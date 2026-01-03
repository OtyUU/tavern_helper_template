import { defineMvuDataStore } from '@/util/mvu';
import { Schema } from '../../schema';

export const useDataStore = defineMvuDataStore(
  Schema,
  { type: 'message', message_id: getCurrentMessageId() },
  // Set up with default values if MVU data is empty
  data => {
    if (_.isEmpty(data.value)) {
      data.value = {
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
          mood: 'playful',
          energy_level: 80,
          outfit: {},
          current_activity: 'Playing',
          favorite_things: {},
        },
        sato: {
          inventory: {},
          kinako_gifts_received: {},
          relationship_notes: '',
        },
      };
    }
  },
);

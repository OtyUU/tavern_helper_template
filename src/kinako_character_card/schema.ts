export const Schema = z.object({
  world: z.object({
    current_time: z.string().describe('Format: YYYY-MM-DD HH:MM'),
    current_location: z.string(),
    weather: z.string().prefault('Sunny'),
    recent_events: z.record(z.string().describe('Event name'), z.string().describe('Event description')),
  }),

  kinako: z
    .object({
      affection: z.coerce.number().transform(v => _.clamp(v, 0, 100)),
      mood: z.enum(['happy', 'playful', 'pouty', 'sleepy', 'curious', 'tantrum', 'clingy']).prefault('playful'),
      energy_level: z.coerce.number().transform(v => _.clamp(v, 0, 100)),
      outfit: z.partialRecord(
        z.enum(['top', 'bottom', 'underwear', 'accessories', 'costume']),
        z.string().describe('Clothing description'),
      ),
      current_activity: z.string().prefault('Playing'),
      favorite_things: z.record(
        z.string().describe('Item or activity name'),
        z.object({
          description: z.string(),
          interest_level: z.coerce.number().transform(v => _.clamp(v, 0, 10)),
        }),
      ),
    })
    .transform(data => {
      const $affection_stage =
        data.affection < 20
          ? 'distant'
          : data.affection < 40
            ? 'warming_up'
            : data.affection < 60
              ? 'attached'
              : data.affection < 80
                ? 'deeply_bonded'
                : 'devoted';
      return { ...data, $affection_stage };
    }),

  sato: z.object({
    inventory: z
      .record(
        z.string().describe('Item name'),
        z.object({
          description: z.string(),
          quantity: z.coerce.number(),
        }),
      )
      .transform(data => _.pickBy(data, ({ quantity }) => quantity > 0)),
    kinako_gifts_received: z.record(z.string().describe('Gift name'), z.string().describe('When received')),
    relationship_notes: z.string().prefault(''),
  }),
});
export type Schema = z.output<typeof Schema>;

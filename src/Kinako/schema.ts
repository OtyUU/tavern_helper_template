export const Schema = z.object({
  affection: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  mood: z.enum(['happy', 'angry', 'sad', 'excited', 'bored']).default('happy'),
  energy: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  trust: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  dependency: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  inventory: z
    .record(
      z.string().describe('item name'),
      z.object({
        description: z.string(),
        quantity: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      }),
    )
    .prefault({}),
  titles: z.array(z.string()).prefault([]),
  status: z
    .object({
      hunger: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      fatigue: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      happiness: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
    })
    .prefault({}),
  memory: z
    .array(
      z.object({
        event: z.string(),
        timestamp: z.coerce.number().transform(value => _.clamp(value, 0, Number.MAX_SAFE_INTEGER)),
      }),
    )
    .prefault([]),
});
export type Schema = z.output<typeof Schema>;

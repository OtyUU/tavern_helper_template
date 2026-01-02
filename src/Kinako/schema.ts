export const Schema = z.object({
  好感度: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  情绪: z.enum(['开心', '生气', '悲伤', '兴奋', '无聊']).default('开心'),
  能量: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  信任度: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  依赖度: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
  物品栏: z
    .record(
      z.string().describe('物品名'),
      z.object({
        描述: z.string(),
        数量: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      }),
    )
    .prefault({}),
  称号: z.array(z.string()).prefault([]),
  状态: z
    .object({
      饥饿: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      疲劳: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
      快乐: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
    })
    .prefault({}),
  记忆: z
    .array(
      z.object({
        事件: z.string(),
        时间: z.coerce.number().transform(value => _.clamp(value, 0, Number.MAX_SAFE_INTEGER)),
      }),
    )
    .prefault([]),
});
export type Schema = z.output<typeof Schema>;

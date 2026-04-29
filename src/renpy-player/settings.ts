import type { CharacterSpriteConfig } from './types';

const BaseSettingsSchema = z
  .object({
    assetRoot: z.string().default(''),
    assetExtensions: z.string().default('png,jpg,jpeg,webp'),
    stageHeight: z.coerce.number().int().min(200).max(1200).default(480),
    defaultBackgroundScale: z.coerce.number().min(0.5).max(3.0).default(1.0),
    defaultSpriteScale: z.coerce.number().min(0.5).max(3.0).default(1.0),
    defaultSpriteY: z.coerce.number().min(-100).max(100).default(0),
    spriteReferenceHeight: z.coerce.number().int().min(1000).max(4000).default(2000),
    spriteCenterX: z.coerce.number().min(0).max(100).default(50),
    spriteSideSpacing: z.coerce.number().min(0).max(50).default(22),
    closeupBackgroundScale: z.coerce.number().min(0.5).max(3.0).default(1.5),
    closeupSpriteScale: z.coerce.number().min(0.5).max(3.0).default(1.8),
    closeupSpriteY: z.coerce.number().min(-100).max(100).default(0),
    mediumBackgroundScale: z.coerce.number().min(0.5).max(3.0).default(1.2),
    mediumSpriteScale: z.coerce.number().min(0.5).max(3.0).default(1.3),
    mediumSpriteY: z.coerce.number().min(-100).max(100).default(0),
    cameraTransitionMs: z.coerce.number().int().min(0).max(5000).default(350),
    sceneTransitionMs: z.coerce.number().int().min(0).max(2000).default(600),
    expressionChangeMs: z.coerce.number().int().min(0).max(2000).default(160),
    poseChangeMs: z.coerce.number().int().min(0).max(2000).default(90),
    spriteEnterMs: z.coerce.number().int().min(0).max(2000).default(160),
    spriteExitMs: z.coerce.number().int().min(0).max(2000).default(160),
    spriteVisibilityEffect: z.enum(['fade', 'none']).default('fade'),
    characterSpriteConfig: z.string().default('{}'),
    defaultSpriteLayout: z.enum(['outfit_pose', 'flat']).default('outfit_pose'),
    defaultPose: z.string().default('base'),
    defaultExpression: z.string().default('neutral'),
    globalPoseTokens: z.string().default('base,burst,lean,sit,stand'),
    autoPlayDelayMs: z.coerce.number().int().min(500).max(20000).default(2500),
    followLatestPlayable: z.boolean().default(true),
    preferredMessageId: z.preprocess(value => {
      if (value == null || value === '') {
        return null;
      }
      if (typeof value === 'number' && Number.isNaN(value)) {
        return null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const coerced = Number(trimmed);
        return Number.isNaN(coerced) ? value : coerced;
      }
      return value;
    }, z.number().int().nullable()).default(null),
  });

const SettingsSchema = BaseSettingsSchema.prefault({});

type RenpyPlayerSettings = z.infer<typeof SettingsSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPersistedSettings(scriptId: string): {
  value: RenpyPlayerSettings;
  repaired: boolean;
  invalidKeys: string[];
} {
  const raw = getVariables({ type: 'script', script_id: scriptId });
  const source = isRecord(raw) ? raw : {};
  const parsed = SettingsSchema.safeParse(source);
  if (parsed.success) {
    return {
      value: parsed.data,
      repaired: !isRecord(raw),
      invalidKeys: [],
    };
  }

  const defaults = SettingsSchema.parse({});
  const repaired = { ...defaults } as Record<string, unknown>;
  const invalidKeys: string[] = [];
  const shape = BaseSettingsSchema.shape as Record<string, z.ZodTypeAny>;

  for (const [key, schema] of Object.entries(shape)) {
    const result = schema.safeParse(source[key]);
    if (result.success) {
      repaired[key] = result.data;
      continue;
    }
    if (key in source) {
      invalidKeys.push(key);
    }
  }

  return {
    value: repaired as RenpyPlayerSettings,
    repaired: true,
    invalidKeys,
  };
}

const CharacterSpriteConfigEntryFieldSchemas = {
  layout: z.enum(['outfit_pose', 'flat']).optional(),
  defaultOutfit: z.string().optional(),
  poseTokens: z.array(z.string()).optional(),
  referenceHeight: z.coerce.number().int().min(1000).max(4000).optional(),
} satisfies Record<string, z.ZodTypeAny>;

function parseCharacterSpriteConfig(source: string): {
  value: Record<string, CharacterSpriteConfig>;
  error: string | null;
} {
  if (!source.trim()) {
    return { value: {}, error: null };
  }

  try {
    const parsed = JSON.parse(source);
    if (!isRecord(parsed)) {
      return {
        value: {},
        error: 'Character sprite config must be a JSON object.',
      };
    }

    const sanitized: Record<string, CharacterSpriteConfig> = {};

    for (const [key, rawValue] of Object.entries(parsed)) {
      if (key.startsWith('_')) {
        continue;
      }
      if (!isRecord(rawValue)) {
        continue;
      }

      const nextConfig: CharacterSpriteConfig = {};
      for (const [field, schema] of Object.entries(CharacterSpriteConfigEntryFieldSchemas)) {
        const result = schema.safeParse(rawValue[field]);
        if (result.success && result.data !== undefined) {
          nextConfig[field as keyof typeof CharacterSpriteConfigEntryFieldSchemas] = result.data;
        }
      }

      sanitized[key] = nextConfig;
    }

    return { value: sanitized, error: null };
  } catch (error) {
    return {
      value: {},
      error: error instanceof Error ? error.message : 'Unable to parse JSON.',
    };
  }
}

export const useRenpyPlayerSettingsStore = defineStore('renpy-player-settings', () => {
  const scriptId = getScriptId();
  const variableTarget = { type: 'script', script_id: scriptId } as const;
  const initialSettings = loadPersistedSettings(scriptId);
  const settings = ref(initialSettings.value);

  if (initialSettings.repaired) {
    insertOrAssignVariables(klona(initialSettings.value), variableTarget);
    if (initialSettings.invalidKeys.length > 0) {
      console.warn(`[renpy-player] Repaired invalid saved settings: ${initialSettings.invalidKeys.join(', ')}`);
    }
  }

  watch(
    settings,
    value => {
      insertOrAssignVariables(klona(value), variableTarget);
    },
    { deep: true },
  );

  const assetExtensions = computed(() =>
    settings.value.assetExtensions
      .split(',')
      .map(extension => extension.trim().replace(/^\./, ''))
      .filter(Boolean),
  );

  const globalPoseTokens = computed(() =>
    settings.value.globalPoseTokens
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
  );

  const characterSpriteConfigParsed = ref<Record<string, CharacterSpriteConfig>>({});
  const characterSpriteConfigError = ref<string | null>(null);

  watch(
    () => settings.value.characterSpriteConfig,
    (jsonString) => {
      const result = parseCharacterSpriteConfig(jsonString);
      characterSpriteConfigParsed.value = result.value;
      characterSpriteConfigError.value = result.error;
    },
    { immediate: true }
  );

  return {
    settings,
    assetExtensions,
    globalPoseTokens,
    characterSpriteConfig: characterSpriteConfigParsed,
    characterSpriteConfigError,
  };
});

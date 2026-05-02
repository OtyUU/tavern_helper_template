import { getInitialState } from './parser';
import type { InitialPlayerState, FrameBuildOptions, SpriteState } from './types';
import { useRenpyPlayerSettingsStore } from './settings';

let activeGenerationType: string | null = null;

function formatPlayerStatus(
  state: InitialPlayerState,
  defaults: { defaultPose: string; defaultExpression: string },
): string {
  const visibleSprites = Object.values(state.sprites).filter(
    (s: SpriteState) => s.position != null,
  );

  if (!state.backgroundName && visibleSprites.length === 0) return '';

  const lines: string[] = [];

  if (state.backgroundName) {
    let scene = `scene ${state.backgroundName}`;
    if (state.backgroundSegment) scene += ` ${state.backgroundSegment}`;
    lines.push(scene);
  }

  if (state.cameraTransform) {
    lines.push(`camera at ${state.cameraTransform}`);
  }

  for (const sprite of visibleSprites) {
    const outfit = sprite.outfit ?? 'default';
    const pose = sprite.pose ?? defaults.defaultPose;
    const expression = sprite.expression ?? defaults.defaultExpression;
    let line = `show ${sprite.character} in ${outfit} ${pose} ${expression}`;
    if (sprite.blush) line += ' blush';
    line += ` at ${sprite.position}`;
    lines.push(line);
  }

  const visibleSet = new Set(visibleSprites.map((s: SpriteState) => s.id));
  const offstage = Object.entries(state.rememberedOutfits).filter(
    ([key]) => !visibleSet.has(key),
  );
  if (offstage.length > 0) {
    lines.push('');
    lines.push('[offstage]');
    for (const [character, outfit] of offstage) {
      lines.push(`${character}: ${outfit}`);
    }
  }

  return lines.join('\n');
}

function computePlayerStatusInner(): string {
  const store = useRenpyPlayerSettingsStore();
  const { settings, assetExtensions, globalPoseTokens, characterSpriteConfig } =
    storeToRefs(store);

  const lastId = getLastMessageId();
  if (lastId < 0) return '';

  if (activeGenerationType === null) {
    console.warn('[RenPy Player] player_status: generation type unknown, defaulting to full history');
  }

  const isRegen =
    activeGenerationType === 'swipe' || activeGenerationType === 'regenerate';
  const upToId = isRegen ? lastId - 1 : lastId;
  if (upToId < 0) return '';

  const allMessages = getChatMessages(`0-${upToId}`);
  const messagesBackwards: string[] = [];
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i]?.message) {
      messagesBackwards.push(allMessages[i].message);
    }
  }

  const buildOptions: FrameBuildOptions = {
    assetRoot: '',
    assetExtensions: [],
    characterSpriteConfig: characterSpriteConfig.value,
    defaultPose: settings.value.defaultPose,
    defaultExpression: settings.value.defaultExpression,
    globalPoseTokens: globalPoseTokens.value,
  };

  const state = getInitialState(messagesBackwards, buildOptions);
  return formatPlayerStatus(state, {
    defaultPose: settings.value.defaultPose,
    defaultExpression: settings.value.defaultExpression,
  });
}

export function computePlayerStatus(): string {
  try {
    return computePlayerStatusInner();
  } catch (error) {
    console.error('[RenPy Player] Error computing player_status:', error);
    return '';
  }
}

export function registerPlayerStatusMacro(): { unregister: () => void } {
  const startedHandle = eventOn(tavern_events.GENERATION_STARTED, (type) => {
    activeGenerationType = type;
  });
  const endedHandle = eventOn(tavern_events.GENERATION_ENDED, () => {
    activeGenerationType = null;
  });
  const macroHandle = registerMacroLike(
    /\{\{vn_state\}\}/gi,
    () => computePlayerStatus(),
  );

  return {
    unregister: () => {
      startedHandle.stop();
      endedHandle.stop();
      macroHandle.unregister();
      activeGenerationType = null;
    },
  };
}

import { getInitialState } from './parser';
import type { InitialPlayerState, FrameBuildOptions, SpriteState } from './types';
import { useRenpyPlayerSettingsStore } from './settings';

let activeGenerationType: string | null = null;

function formatPlayerStatus(state: InitialPlayerState): string {
  const lines: string[] = [];
  const hasBackground = !!state.backgroundName;
  const sprites = Object.values(state.sprites).filter(
    (s: SpriteState) => s.position != null,
  );
  const hasSprites = sprites.length > 0;

  if (!hasBackground && !hasSprites) return '';

  lines.push('[Scene Status]');

  if (hasBackground) {
    let bg = state.backgroundName!;
    if (state.backgroundSegment) bg += ` (${state.backgroundSegment})`;
    lines.push(`Background: ${bg}`);
  }

  if (state.cameraTransform) {
    lines.push(`Camera: ${state.cameraTransform}`);
  }

  if (hasSprites) {
    lines.push('Characters:');
    for (const sprite of sprites) {
      const parts: string[] = [`${sprite.character}:`];
      if (sprite.outfit) parts.push(`outfit=${sprite.outfit}`);
      if (sprite.pose) parts.push(`pose=${sprite.pose}`);
      if (sprite.expression) parts.push(`expression=${sprite.expression}`);
      if (sprite.position) parts.push(`position=${sprite.position}`);
      if (sprite.blush) parts.push('blush');
      lines.push(`- ${parts.join(' ')}`);
    }
  } else {
    lines.push('Characters: none');
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

  const messagesBackwards: string[] = [];
  for (let id = upToId; id >= 0; id--) {
    const msg = getChatMessages(id)[0];
    if (msg?.message) {
      messagesBackwards.push(msg.message);
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
  return formatPlayerStatus(state);
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
    /\{\{player_status\}\}/gi,
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

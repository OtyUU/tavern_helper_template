import type {
  CameraAnimation,
  CameraTransform,
  CharacterSpriteConfig,
  FrameBuildOptions,
  InitialPlayerState,
  ParsedScript,
  PlayerAsset,
  PlayerFrame,
  SceneCommand,
  ScriptCommand,
  ShowCommand,
  SpritePosition,
  SpriteState,
  TransitionName,
  TransitionSpec,
} from './types';

type ParsedLines = Pick<ParsedScript, 'commands' | 'ignoredLines'>;

// ─── Utilities ───────────────────────────────────────────────────────────────

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function normalizeToken(token: string): string {
  return token.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/g, '');
}

function joinPath(...parts: string[]): string {
  const filtered = parts.map(part => part.replace(/\\/g, '/')).filter(part => part.length > 0);
  if (filtered.length === 0) return '';
  const [first, ...rest] = filtered;
  const cleanedRest = rest.map(part => part.replace(/^\/+|\/+$/g, ''));
  if (/^[a-z]+:\/\//i.test(first)) {
    return [trimTrailingSlash(first), ...cleanedRest].filter(Boolean).join('/');
  }
  if (first.startsWith('/')) {
    return '/' + [first.replace(/^\/+|\/+$/g, ''), ...cleanedRest].filter(Boolean).join('/');
  }
  return [first.replace(/^\/+|\/+$/g, ''), ...cleanedRest].filter(Boolean).join('/');
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const body = value.slice(1, -1);
  return body.replace(/\\(["'])/g, '$1').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function createTokenCandidates(token: string): string[] {
  const raw = normalizeToken(token);
  if (!raw) return [];
  // Just lowercase - keep underscores as-is (they're part of token names)
  return [raw.toLowerCase()];
}

function createNameCandidates(name: string, aliases: Record<string, string>): string[] {
  const raw = normalizeToken(name);
  const lower = raw.toLowerCase();
  const alias = aliases[raw] ?? aliases[lower];
  if (alias) {
    return [alias.toLowerCase(), lower];
  }
  return [lower];
}

function createBackgroundTokenCandidates(token: string): string[] {
  const raw = normalizeToken(token);
  if (!raw) return [];
  // Just lowercase - keep underscores as-is (they're part of token names)
  return [raw.toLowerCase()];
}

function getSpeakerLabel(speaker: string, aliases: Record<string, string>): string {
  const raw = speaker.trim();
  const alias = aliases[raw] ?? aliases[raw.toLowerCase()];
  if (alias) return alias;
  if (raw.toLowerCase() === 'narrator') return 'Narrator';
  return raw.length > 1 ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw.toUpperCase();
}

// ─── Transform categorization ────────────────────────────────────────────────

const CAMERA_TRANSFORMS = new Set(['closeup', 'medium']);
const CAMERA_ANIMATIONS = new Set(['shake']);
const SPRITE_TRANSFORMS = new Set(['shake', 'bounce', 'pulse']);
const SPRITE_POSITIONS = new Set(['left', 'center', 'right']);
const SHOW_TRANSFORMS = new Set([...SPRITE_POSITIONS, ...SPRITE_TRANSFORMS]);
const CAMERA_COMMAND_TRANSFORMS = new Set([...CAMERA_TRANSFORMS, ...CAMERA_ANIMATIONS]);
const SUPPORTED_TRANSITIONS = new Set<TransitionName>(['dissolve', 'fade']);

function splitTransforms(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function hasOnlyAllowedTransforms(transforms: string[], allowed: Set<string>): boolean {
  return transforms.every(transform => allowed.has(transform.trim().toLowerCase()));
}

function parseTransitionName(value: string): TransitionName | undefined {
  const name = value.trim().toLowerCase();
  if (!SUPPORTED_TRANSITIONS.has(name as TransitionName)) {
    return undefined;
  }
  return name as TransitionName;
}

function createTransitionSpec(name: string): TransitionSpec | undefined {
  const parsed = parseTransitionName(name);
  if (!parsed) {
    return undefined;
  }
  return { name: parsed };
}

function extractInlineTransition(value: string): {
  remainder: string;
  transition?: TransitionSpec;
  valid: boolean;
} {
  const match = value.match(/^(.*?)(?:\s+with\s+([A-Za-z0-9_]+))?$/i);
  if (!match) {
    return { remainder: value.trim(), valid: true };
  }

  const remainder = (match[1] ?? '').trim();
  const transitionName = match[2];
  if (!transitionName) {
    return { remainder, valid: true };
  }

  const transition = createTransitionSpec(transitionName);
  if (!transition) {
    return { remainder, valid: false };
  }

  return { remainder, transition, valid: true };
}

function categorizeCameraTransforms(transforms: string[]): {
  cameraTransform?: CameraTransform;
  cameraAnimations: CameraAnimation[];
} {
  let cameraTransform: CameraTransform | undefined;
  const cameraAnimations: CameraAnimation[] = [];
  for (const t of transforms) {
    const lower = t.trim().toLowerCase();
    if (CAMERA_TRANSFORMS.has(lower)) {
      cameraTransform = lower as CameraTransform;
    } else if (CAMERA_ANIMATIONS.has(lower)) {
      cameraAnimations.push(lower as CameraAnimation);
    }
  }
  return { cameraTransform, cameraAnimations };
}

function categorizeShowTransforms(transforms: string[]): {
  spritePosition?: SpritePosition;
  spriteAnimations: string[];
} {
  let spritePosition: SpritePosition | undefined;
  const spriteAnimations: string[] = [];
  for (const t of transforms) {
    const lower = t.trim().toLowerCase();
    if (SPRITE_POSITIONS.has(lower)) {
      spritePosition = lower as SpritePosition;
    } else if (SPRITE_TRANSFORMS.has(lower)) {
      spriteAnimations.push(lower);
    }
  }
  return { spritePosition, spriteAnimations };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseLines(source: string): ParsedLines {
  const commands: ScriptCommand[] = [];
  const ignoredLines: string[] = [];

  source
    .split(/\r?\n/g)
    .map(line => line.trim())
    .forEach(line => {
      if (!line || line.startsWith('#') || line.startsWith('//')) return;

      // scene <background> [<segment>]
      const sceneMatch = line.match(/^scene\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9_-]+))?(?:\s+with\s+([A-Za-z0-9_]+))?$/i);
      if (sceneMatch) {
        const transition = sceneMatch[3] ? createTransitionSpec(sceneMatch[3]) : undefined;
        if (sceneMatch[3] && !transition) {
          ignoredLines.push(line);
          return;
        }

        commands.push({
          type: 'scene',
          raw: line,
          background: sceneMatch[1],
          segment: sceneMatch[2],
          transition,
        });
        return;
      }

      // hide <character>
      const hideMatch = line.match(/^hide\s+([A-Za-z0-9_-]+)(?:\s+with\s+([A-Za-z0-9_]+))?$/i);
      if (hideMatch) {
        const transition = hideMatch[2] ? createTransitionSpec(hideMatch[2]) : undefined;
        if (hideMatch[2] && !transition) {
          ignoredLines.push(line);
          return;
        }

        commands.push({
          type: 'hide',
          raw: line,
          character: hideMatch[1],
          transition,
        });
        return;
      }

      const withMatch = line.match(/^with\s+([A-Za-z0-9_]+)$/i);
      if (withMatch) {
        const transition = createTransitionSpec(withMatch[1]);
        if (!transition) {
          ignoredLines.push(line);
          return;
        }

        commands.push({
          type: 'with',
          raw: line,
          transition,
        });
        return;
      }

      // camera
      if (/^camera$/i.test(line)) {
        commands.push({
          type: 'camera',
          raw: line,
          clear: true,
        });
        return;
      }

      const cameraMatch = line.match(/^camera\s+at\s+(.+)$/i);
      if (cameraMatch) {
        const inlineTransition = extractInlineTransition(cameraMatch[1]);
        if (!inlineTransition.valid) {
          ignoredLines.push(line);
          return;
        }

        const transforms = splitTransforms(inlineTransition.remainder);
        if (transforms.length === 0 || !hasOnlyAllowedTransforms(transforms, CAMERA_COMMAND_TRANSFORMS)) {
          ignoredLines.push(line);
          return;
        }

        commands.push({
          type: 'camera',
          raw: line,
          clear: false,
          transforms,
          transition: inlineTransition.transition,
        });
        return;
      }

      // show <character> [...]
      const showMatch = line.match(/^show\s+([A-Za-z0-9_-]+)(.*)?$/i);
      if (showMatch) {
        const character = showMatch[1];
        let rest = (showMatch[2] ?? '').trim();

        const inlineTransition = extractInlineTransition(rest);
        if (!inlineTransition.valid) {
          ignoredLines.push(line);
          return;
        }
        rest = inlineTransition.remainder;
        const transition = inlineTransition.transition;

        // 1. Extract "at <t1>, <t2>, ..." from the end
        let transforms: string[] = [];
        const atMatch = rest.match(/\bat\s+(.+)$/i);
        if (atMatch) {
          transforms = splitTransforms(atMatch[1]);
          if (transforms.length === 0 || !hasOnlyAllowedTransforms(transforms, SHOW_TRANSFORMS)) {
            ignoredLines.push(line);
            return;
          }
          rest = rest.slice(0, atMatch.index).trim();
        }

        // 2. Extract "in <outfit>"
        let outfit: string | undefined;
        const inMatch = rest.match(/\bin\s+([A-Za-z0-9_-]+)\b/i);
        if (inMatch) {
          outfit = inMatch[1];
          rest = (rest.slice(0, inMatch.index) + rest.slice((inMatch.index ?? 0) + inMatch[0].length)).trim();
        }

        // 3. Extract "blush" keyword
        let blush = false;
        rest = rest.replace(/\bblush\b/gi, () => { blush = true; return ''; }).trim();

        // 4. Remaining tokens = pose/expression candidates
        const tokens = rest.split(/\s+/).map(t => t.trim()).filter(Boolean);

        commands.push({
          type: 'show',
          raw: line,
          character,
          outfit,
          blush: blush || undefined,
          transforms: transforms.length > 0 ? transforms : undefined,
          transition,
          tokens,
        });
        return;
      }

      // dialogue: <speaker> "<text>"
      const dialogueMatch = line.match(/^([A-Za-z_][\w-]*)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/);
      if (dialogueMatch) {
        commands.push({
          type: 'dialogue',
          raw: line,
          speaker: dialogueMatch[1],
          text: unquote(dialogueMatch[2]),
        });
        return;
      }

      // narration: "<text>"
      const narrationMatch = line.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/);
      if (narrationMatch) {
        commands.push({
          type: 'dialogue',
          raw: line,
          speaker: 'narrator',
          text: unquote(narrationMatch[1]),
        });
        return;
      }

      ignoredLines.push(line);
    });

  return { commands, ignoredLines };
}

function scoreCandidate(source: string): number {
  return parseLines(source).commands.length;
}

export function parseScriptFromMessage(message: string): ParsedScript {
  const fencedBlocks = [...message.matchAll(/```(?:[\w-]+)?\s*([\s\S]*?)```/g)]
    .map(match => match[1].trim())
    .filter(Boolean);

  const bestFenced = fencedBlocks
    .map(block => ({ block, score: scoreCandidate(block) }))
    .sort((lhs, rhs) => rhs.score - lhs.score)[0];

  if (bestFenced && bestFenced.score > 0) {
    const parsed = parseLines(bestFenced.block);
    return { source: 'fenced', scriptText: bestFenced.block, commands: parsed.commands, ignoredLines: parsed.ignoredLines };
  }

  const parsedWholeMessage = parseLines(message);
  if (parsedWholeMessage.commands.length > 0 || parsedWholeMessage.ignoredLines.length > 0) {
    return { source: 'message', scriptText: message.trim(), commands: parsedWholeMessage.commands, ignoredLines: parsedWholeMessage.ignoredLines };
  }

  return { source: 'none', scriptText: '', commands: [], ignoredLines: [] };
}

// ─── Background asset ────────────────────────────────────────────────────────

function createBackgroundAsset(command: SceneCommand, options: FrameBuildOptions): PlayerAsset | undefined {
  const root = trimTrailingSlash(options.backgroundRoot);
  const name = command.background.toLowerCase();
  const segment = command.segment?.toLowerCase();
  const extensions = unique(options.assetExtensions);

  const candidates = extensions.flatMap(ext =>
    segment
      ? [joinPath(root, `${name}-${segment}.${ext}`)]  // dash joiner
      : [joinPath(root, `${name}.${ext}`)]
  );

  if (candidates.length === 0) return undefined;
  return {
    candidates,
    description: command.segment ? `${command.background}-${command.segment}` : command.background,
  };
}

// ─── Sprite candidate generation ─────────────────────────────────────────────

function createSpriteAssetOutfitPose(
  character: string,
  outfit: string,
  pose: string,
  expression: string,
  blush: boolean,
  options: FrameBuildOptions,
): PlayerAsset | undefined {
  const root = trimTrailingSlash(options.spriteRoot);
  const char = character.toLowerCase();
  const out = outfit.toLowerCase();
  const pos = pose.toLowerCase();
  const expr = expression.toLowerCase();

  const candidates = options.assetExtensions.flatMap(ext => {
    const paths: string[] = [];
    if (blush) {
      paths.push(joinPath(root, char, out, pos, `${expr}-blush.${ext}`));  // dash for blush
    }
    paths.push(joinPath(root, char, out, pos, `${expr}.${ext}`));
    return paths;
  });

  if (candidates.length === 0) return undefined;
  return {
    candidates,
    description: `${character}/${outfit}/${pose}/${expression}${blush ? '-blush' : ''}`,
  };
}

function createSpriteAssetFlat(
  character: string,
  expression: string,
  blush: boolean,
  options: FrameBuildOptions,
): PlayerAsset | undefined {
  const root = trimTrailingSlash(options.spriteRoot);
  const char = character.toLowerCase();
  const expr = expression.toLowerCase();

  const candidates = options.assetExtensions.flatMap(ext => {
    const paths: string[] = [];
    if (blush) {
      paths.push(joinPath(root, char, `${expr}-blush.${ext}`));  // dash for blush
    }
    paths.push(joinPath(root, char, `${expr}.${ext}`));
    return paths;
  });

  if (candidates.length === 0) return undefined;
  return {
    candidates,
    description: `${character}/${expression}${blush ? '-blush' : ''}`,
  };
}

// ─── Config resolution helpers ───────────────────────────────────────────────

function getCharacterConfig(
  character: string,
  options: FrameBuildOptions,
): Required<Pick<CharacterSpriteConfig, 'layout' | 'poseTokens'>> & { defaultOutfit: string } {
  const cfg = options.characterSpriteConfig[character] ?? {};
  return {
    layout: cfg.layout ?? options.defaultSpriteLayout,
    defaultOutfit: cfg.defaultOutfit ?? 'default',
    poseTokens: cfg.poseTokens ?? options.globalPoseTokens,
  };
}

/**
 * Resolve remaining tokens (0–2) into pose and expression.
 * Single-token: check poseTokens to disambiguate.
 */
function resolveTokens(
  tokens: string[],
  poseTokens: string[],
  fallbackPose: string,
  fallbackExpression: string,
): { pose: string; expression: string } {
  if (tokens.length >= 2) {
    return { pose: tokens[0], expression: tokens[1] };
  }
  if (tokens.length === 1) {
    const t = tokens[0];
    if (poseTokens.includes(t)) {
      return { pose: t, expression: fallbackExpression };
    }
    return { pose: fallbackPose, expression: t };
  }
  return { pose: fallbackPose, expression: fallbackExpression };
}

function resolveShowState(
  command: ShowCommand,
  existing: SpriteState | undefined,
  rememberedOutfits: Record<string, string>,
  options: FrameBuildOptions,
): SpriteState {
  const id = command.character;
  const cfg = getCharacterConfig(id, options);

  // Outfit: explicit > visible sprite > remembered outfit > defaultOutfit
  const outfit = command.outfit ?? existing?.outfit ?? rememberedOutfits[id] ?? cfg.defaultOutfit;
  const fallbackPose = existing?.pose ?? options.defaultPose;
  const fallbackExpression = existing?.expression ?? options.defaultExpression;
  const { pose, expression } = resolveTokens(
    command.tokens,
    cfg.poseTokens,
    fallbackPose,
    fallbackExpression,
  );

  // Blush persists across non-expression updates and clears when the resolved expression changes,
  // unless the new command explicitly restates `blush`.
  const blush = command.blush
    ? true
    : expression !== fallbackExpression
      ? false
      : (existing?.blush ?? false);

  const newState: SpriteState = {
    id,
    character: id,
    position: existing?.position ?? 'center',
    outfit: cfg.layout === 'outfit_pose' ? outfit : undefined,
    pose: cfg.layout === 'outfit_pose' ? pose : undefined,
    expression,
    blush: blush || undefined,
  };
  newState.asset = buildSpriteAsset(newState, options);
  if (newState.outfit) {
    rememberedOutfits[id] = newState.outfit;
  }

  return newState;
}

function buildSpriteAsset(state: SpriteState, options: FrameBuildOptions): PlayerAsset | undefined {
  const { layout } = getCharacterConfig(state.character, options);
  if (layout === 'flat') {
    return createSpriteAssetFlat(
      state.character,
      state.expression ?? options.defaultExpression,
      state.blush ?? false,
      options,
    );
  }
  return createSpriteAssetOutfitPose(
    state.character,
    state.outfit ?? 'default',
    state.pose ?? options.defaultPose,
    state.expression ?? options.defaultExpression,
    state.blush ?? false,
    options,
  );
}

function buildSpritesArray(
  sprites: Record<string, SpriteState>,
  order: string[],
): PlayerFrame['sprites'] {
  return order.filter(id => id in sprites).map(id => ({
    id,
    position: sprites[id].position,
    asset: sprites[id].asset,
    outfit: sprites[id].outfit,
    pose: sprites[id].pose,
    expression: sprites[id].expression,
    blush: sprites[id].blush,
    animations: sprites[id].animations,
  }));
}

function clearTransientAnimations(sprites: Record<string, SpriteState>): void {
  for (const sprite of Object.values(sprites)) {
    delete sprite.animations;
  }
}

function createRememberedOutfits(initialState?: InitialPlayerState): Record<string, string> {
  const rememberedOutfits = { ...(initialState?.rememberedOutfits ?? {}) };

  for (const sprite of Object.values(initialState?.sprites ?? {})) {
    if (sprite.outfit) {
      rememberedOutfits[sprite.id] = sprite.outfit;
    }
  }

  return rememberedOutfits;
}

// ─── Frame builder ───────────────────────────────────────────────────────────

export function buildFrames(parsed: ParsedScript, options: FrameBuildOptions): PlayerFrame[] {
  const frames: PlayerFrame[] = [];
  let background: PlayerAsset | undefined = options.initialState?.background;
  let backgroundName: string = options.initialState?.backgroundName ?? '';
  let backgroundSegment: string | undefined = options.initialState?.backgroundSegment;
  let cameraTransform: CameraTransform | undefined = options.initialState?.cameraTransform;
  let pendingCameraAnimations: CameraAnimation[] = [];

  // sprites map + insertion-order list
  const sprites: Record<string, SpriteState> = { ...(options.initialState?.sprites ?? {}) };
  const rememberedOutfits = createRememberedOutfits(options.initialState);
  const spriteOrder: string[] = Object.keys(sprites);
  let pendingVisualOnlyFrame = false;

  function pushFrame({
    speaker,
    text,
    transition,
  }: {
    speaker?: string;
    text?: string;
    transition?: TransitionSpec;
  }) {
    frames.push({
      index: frames.length,
      background,
      cameraTransform,
      cameraAnimations: pendingCameraAnimations.length > 0 ? [...pendingCameraAnimations] : undefined,
      transition,
      sprites: buildSpritesArray(sprites, spriteOrder),
      speaker,
      text,
    });
    clearTransientAnimations(sprites);
    pendingCameraAnimations = [];
    pendingVisualOnlyFrame = false;
  }

  function pushTransitionPreview(transition: TransitionSpec) {
    const hasVisuals = background || spriteOrder.length > 0;
    if (!hasVisuals) {
      return;
    }

    pushFrame({
      transition,
      speaker: 'Scene Preview',
      text: `Applied ${transition.name} to the latest stage change.`,
    });
  }

  parsed.commands.forEach(command => {
    switch (command.type) {
      case 'scene': {
        const bg = command.background || backgroundName;
        const seg = command.segment ?? backgroundSegment;
        backgroundName = bg;
        backgroundSegment = seg;
        background = createBackgroundAsset({ ...command, background: bg, segment: seg }, options);
        // Clear visible sprites, but keep remembered outfits for later shows.
        for (const id of Object.keys(sprites)) delete sprites[id];
        spriteOrder.length = 0;
        pendingVisualOnlyFrame = true;
        if (command.transition) {
          pushTransitionPreview(command.transition);
        }
        return;
      }

      case 'hide': {
        const id = command.character;
        delete sprites[id];
        const idx = spriteOrder.indexOf(id);
        if (idx !== -1) spriteOrder.splice(idx, 1);
        pendingVisualOnlyFrame = true;
        if (command.transition) {
          pushTransitionPreview(command.transition);
        }
        return;
      }

      case 'camera': {
        if (command.clear) {
          cameraTransform = undefined;
          pendingCameraAnimations = [];
        } else if (command.transforms?.length) {
          const { cameraTransform: nextCameraTransform, cameraAnimations } = categorizeCameraTransforms(command.transforms);
          if (nextCameraTransform) {
            cameraTransform = nextCameraTransform;
          }
          pendingCameraAnimations = cameraAnimations;
        }
        pendingVisualOnlyFrame = true;
        if (command.transition) {
          pushTransitionPreview(command.transition);
        }
        return;
      }

      case 'show': {
        const id = command.character;
        const existing = sprites[id];

        const newState = resolveShowState(command, existing, rememberedOutfits, options);

        // Transforms
        if (command.transforms && command.transforms.length > 0) {
          const { spritePosition, spriteAnimations } = categorizeShowTransforms(command.transforms);
          if (spritePosition) {
            newState.position = spritePosition;
          }
          newState.animations = spriteAnimations.length > 0 ? spriteAnimations : undefined;
        }

        // Update order: move to end (most recently shown = top)
        const idx = spriteOrder.indexOf(id);
        if (idx !== -1) spriteOrder.splice(idx, 1);
        spriteOrder.push(id);

        sprites[id] = newState;
        pendingVisualOnlyFrame = true;
        if (command.transition) {
          pushTransitionPreview(command.transition);
        }
        return;
      }

      case 'with': {
        if (pendingVisualOnlyFrame) {
          pushTransitionPreview(command.transition);
        }
        return;
      }

      case 'dialogue': {
        pushFrame({
          speaker: getSpeakerLabel(command.speaker, options.speakerAliases),
          text: command.text,
        });
        return;
      }
    }
  });

  // Fallback frames
  const hasVisuals = background || spriteOrder.length > 0;
  if (frames.length === 0 && hasVisuals) {
    const label = parsed.commands.length > 0 ? 'Scene Preview' : 'Active Scene';
    const text = parsed.commands.length > 0
      ? 'The script updated the stage but did not contain any dialogue lines.'
      : 'This message does not contain any script commands. Displaying inherited state.';
    pushFrame({
      speaker: label,
      text,
    });
  } else if (pendingVisualOnlyFrame && hasVisuals) {
    pushFrame({
      speaker: 'Scene Preview',
      text: 'The last command only changed the scene or sprite state.',
    });
  }

  return frames;
}

// ─── Initial state builder ───────────────────────────────────────────────────

export function getInitialState(messagesBackwards: string[], options: FrameBuildOptions): InitialPlayerState {
  let background: PlayerAsset | undefined;
  let backgroundName: string | undefined;
  let backgroundSegment: string | undefined;
  let cameraTransform: CameraTransform | undefined;
  const sprites: Record<string, SpriteState> = {};
  const rememberedOutfits: Record<string, string> = {};
  const spriteOrder: string[] = [];

  // messagesBackwards[0] = message just before current, built newest→oldest
  // iterate oldest-first so later messages overwrite earlier ones
  for (let i = messagesBackwards.length - 1; i >= 0; i--) {
    const parsed = parseScriptFromMessage(messagesBackwards[i]);

    for (const cmd of parsed.commands) {
      if (cmd.type === 'scene') {
        const bg = cmd.background || backgroundName || '';
        const seg = cmd.segment ?? backgroundSegment;
        backgroundName = bg;
        backgroundSegment = seg;
        background = createBackgroundAsset({ ...cmd, background: bg, segment: seg }, options);
        for (const id of Object.keys(sprites)) delete sprites[id];
        spriteOrder.length = 0;
        continue;
      }

      if (cmd.type === 'hide') {
        const id = cmd.character;
        delete sprites[id];
        const idx = spriteOrder.indexOf(id);
        if (idx !== -1) spriteOrder.splice(idx, 1);
        continue;
      }

      if (cmd.type === 'camera') {
        if (cmd.clear) {
          cameraTransform = undefined;
        } else if (cmd.transforms?.length) {
          const { cameraTransform: nextCameraTransform } = categorizeCameraTransforms(cmd.transforms);
          if (nextCameraTransform) {
            cameraTransform = nextCameraTransform;
          }
        }
        continue;
      }

      if (cmd.type === 'show') {
        const id = cmd.character;
        const existing = sprites[id];

        const newState = resolveShowState(cmd, existing, rememberedOutfits, options);

        if (cmd.transforms && cmd.transforms.length > 0) {
          const { spritePosition } = categorizeShowTransforms(cmd.transforms);
          if (spritePosition) {
            newState.position = spritePosition;
          }
        }

        const idx = spriteOrder.indexOf(id);
        if (idx !== -1) spriteOrder.splice(idx, 1);
        spriteOrder.push(id);
        sprites[id] = newState;
      }
    }
  }

  return {
    background,
    backgroundName,
    backgroundSegment,
    cameraTransform,
    rememberedOutfits,
    sprites,
  };
}

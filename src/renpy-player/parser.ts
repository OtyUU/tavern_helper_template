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
  SpriteState
} from './types';

type ParsedLines = Pick<ParsedScript, 'commands' | 'ignoredLines'>;

// ─── Utilities ───────────────────────────────────────────────────────────────

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/g, '');
}

function buildCandidates(dir: string, baseNames: string[], extensions: string[]): string[] {
  const cleanDir = trimTrailingSlash(dir);
  const exts = unique(extensions);
  return exts.flatMap(ext => baseNames.map(name => joinPath(cleanDir, `${name}.${ext}`)));
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

function getSpeakerLabel(speaker: string): string {
  const raw = speaker.trim();
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

function splitTransforms(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function hasOnlyAllowedTransforms(transforms: string[], allowed: Set<string>): boolean {
  return transforms.every(transform => allowed.has(transform.trim().toLowerCase()));
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
      const sceneMatch = line.match(/^scene\s+([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9_-]+))?$/i);
      if (sceneMatch) {
        commands.push({
          type: 'scene',
          raw: line,
          background: sceneMatch[1],
          segment: sceneMatch[2],
        });
        return;
      }

      // hide <character>
      const hideMatch = line.match(/^hide\s+([A-Za-z0-9_-]+)$/i);
      if (hideMatch) {
        commands.push({
          type: 'hide',
          raw: line,
          character: hideMatch[1],
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
        const transforms = splitTransforms(cameraMatch[1]);
        if (transforms.length === 0 || !hasOnlyAllowedTransforms(transforms, CAMERA_COMMAND_TRANSFORMS)) {
          ignoredLines.push(line);
          return;
        }

        commands.push({
          type: 'camera',
          raw: line,
          clear: false,
          transforms,
        });
        return;
      }

      // show <character> [...]
      const showMatch = line.match(/^show\s+([A-Za-z0-9_-]+)(.*)?$/i);
      if (showMatch) {
        const character = showMatch[1];
        let rest = (showMatch[2] ?? '').trim();

        // 1. Extract trailing "at <t1>, <t2>, ..." clause (must be last)
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

export function parseScriptFromMessage(message: string): ParsedScript {
  // Prefer the first fenced code block if it contains any recognized commands; otherwise parse the whole message.
  const firstFencedMatch = message.match(/```(?:[\w-]+)?\s*([\s\S]*?)```/);
  const firstFenced = firstFencedMatch?.[1]?.trim();

  if (firstFenced) {
    const parsedFenced = parseLines(firstFenced);
    if (parsedFenced.commands.length > 0) {
      return {
        source: 'fenced',
        scriptText: firstFenced,
        commands: parsedFenced.commands,
        ignoredLines: parsedFenced.ignoredLines,
      };
    }
    // else: fall through to whole-message parse (may include later fenced blocks and outside text)
  }

  // Fallback: parse the entire message (includes later fenced blocks and outside text).
  const parsedWholeMessage = parseLines(message);
  if (parsedWholeMessage.commands.length > 0 || parsedWholeMessage.ignoredLines.length > 0) {
    return {
      source: 'message',
      scriptText: message.trim(),
      commands: parsedWholeMessage.commands,
      ignoredLines: parsedWholeMessage.ignoredLines,
    };
  }

  return { source: 'none', scriptText: '', commands: [], ignoredLines: [] };
}

// ─── Background asset ────────────────────────────────────────────────────────

function createBackgroundAsset(command: SceneCommand, options: FrameBuildOptions): PlayerAsset | undefined {
  const root = joinPath(trimTrailingSlash(options.assetRoot), 'bg');
  const name = command.background.toLowerCase();
  const segment = command.segment?.toLowerCase();

  const base = segment ? `${name}-${segment}` : name;
  const candidates = buildCandidates(root, [base], options.assetExtensions);

  if (candidates.length === 0) return undefined;
  return {
    candidates,
    description: segment ? `${command.background}-${command.segment}` : command.background,
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
  const root = trimTrailingSlash(options.assetRoot);
  const char = character.toLowerCase();
  const out = outfit.toLowerCase();
  const pos = pose.toLowerCase();
  const expr = expression.toLowerCase();

  const dir = joinPath(root, char, out, pos);
  const baseNames = blush ? [`${expr}-blush`, expr] : [expr];
  const candidates = buildCandidates(dir, baseNames, options.assetExtensions);

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
  const root = trimTrailingSlash(options.assetRoot);
  const char = character.toLowerCase();
  const expr = expression.toLowerCase();

  const dir = joinPath(root, char);
  const baseNames = blush ? [`${expr}-blush`, expr] : [expr];
  const candidates = buildCandidates(dir, baseNames, options.assetExtensions);

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
 * Resolve remaining tokens (0..N) into pose and expression.
 * If 2+ tokens are present, only the first two are used (pose, expression).
 * If 1 token is present, check poseTokens to disambiguate.
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

// ─── Stage state ─────────────────────────────────────────────────────────────

class StageState {
  private background: PlayerAsset | undefined;
  private backgroundName: string;
  private backgroundSegment: string | undefined;
  private cameraTransform: CameraTransform | undefined;
  private pendingCameraAnimations: CameraAnimation[];
  private sprites: Record<string, SpriteState>;
  private spriteOrder: string[];
  private rememberedOutfits: Record<string, string>;

  constructor(options: FrameBuildOptions, initial?: InitialPlayerState) {
    if (initial) {
      this.background = initial.background;
      this.backgroundName = initial.backgroundName ?? '';
      this.backgroundSegment = initial.backgroundSegment;
      this.cameraTransform = initial.cameraTransform;
      this.sprites = { ...initial.sprites };
      this.rememberedOutfits = { ...(initial.rememberedOutfits ?? {}) };
      for (const sprite of Object.values(initial.sprites)) {
        if (sprite.outfit) {
          this.rememberedOutfits[sprite.id] = sprite.outfit;
        }
      }
      this.spriteOrder = Object.keys(initial.sprites);
    } else {
      this.background = undefined;
      this.backgroundName = '';
      this.backgroundSegment = undefined;
      this.cameraTransform = undefined;
      this.sprites = {};
      this.rememberedOutfits = {};
      this.spriteOrder = [];
    }
    this.pendingCameraAnimations = [];
  }

  apply(cmd: ScriptCommand, options: FrameBuildOptions): void {
    switch (cmd.type) {
      case 'scene': {
        const bg = cmd.background;
        const seg = cmd.segment ?? this.backgroundSegment;
        this.backgroundName = bg;
        this.backgroundSegment = seg;
        this.background = createBackgroundAsset({ ...cmd, background: bg, segment: seg }, options);
        for (const id of Object.keys(this.sprites)) delete this.sprites[id];
        this.spriteOrder.length = 0;
        return;
      }

      case 'hide': {
        const id = cmd.character;
        delete this.sprites[id];
        const idx = this.spriteOrder.indexOf(id);
        if (idx !== -1) this.spriteOrder.splice(idx, 1);
        return;
      }

      case 'camera': {
        if (cmd.clear) {
          this.cameraTransform = undefined;
          this.pendingCameraAnimations = [];
        } else if (cmd.transforms?.length) {
          const { cameraTransform: nextCameraTransform, cameraAnimations } = categorizeCameraTransforms(cmd.transforms);
          if (nextCameraTransform) {
            this.cameraTransform = nextCameraTransform;
          }
          this.pendingCameraAnimations = cameraAnimations;
        }
        return;
      }

      case 'show': {
        const id = cmd.character;
        const existing = this.sprites[id];

        const newState = resolveShowState(cmd, existing, this.rememberedOutfits, options);

        if (cmd.transforms && cmd.transforms.length > 0) {
          const { spritePosition, spriteAnimations } = categorizeShowTransforms(cmd.transforms);
          if (spritePosition) {
            newState.position = spritePosition;
          }
          newState.animations = spriteAnimations.length > 0 ? spriteAnimations : undefined;
        }

        const idx = this.spriteOrder.indexOf(id);
        if (idx !== -1) this.spriteOrder.splice(idx, 1);
        this.spriteOrder.push(id);

        this.sprites[id] = newState;
        return;
      }

      case 'dialogue': {
        return;
      }
    }
  }

  flush(): {
    background: PlayerAsset | undefined;
    cameraTransform: CameraTransform | undefined;
    cameraAnimations: CameraAnimation[] | undefined;
    sprites: PlayerFrame['sprites'];
  } {
    const result = {
      background: this.background,
      cameraTransform: this.cameraTransform,
      cameraAnimations: this.pendingCameraAnimations.length > 0
        ? [...this.pendingCameraAnimations]
        : undefined,
      sprites: buildSpritesArray(this.sprites, this.spriteOrder),
    };

    this.pendingCameraAnimations = [];
    for (const sprite of Object.values(this.sprites)) {
      delete sprite.animations;
    }

    return result;
  }

  hasVisuals(): boolean {
    return !!(this.background || this.spriteOrder.length > 0);
  }

  getBackground(): PlayerAsset | undefined {
    return this.background;
  }

  getCameraTransform(): CameraTransform | undefined {
    return this.cameraTransform;
  }

  getBackgroundName(): string {
    return this.backgroundName;
  }

  getBackgroundSegment(): string | undefined {
    return this.backgroundSegment;
  }

  getRememberedOutfits(): Record<string, string> {
    return this.rememberedOutfits;
  }

  getSpritesMap(): Record<string, SpriteState> {
    return { ...this.sprites };
  }
}

// ─── Frame builder ───────────────────────────────────────────────────────────

export function buildFrames(parsed: ParsedScript, options: FrameBuildOptions): PlayerFrame[] {
  const frames: PlayerFrame[] = [];
  const stage = new StageState(options, options.initialState);
  let dirty = false;
  let isNewScene = false;

  for (const cmd of parsed.commands) {
    if (cmd.type === 'dialogue') {
      frames.push({
        index: frames.length,
        speaker: getSpeakerLabel(cmd.speaker),
        text: cmd.text,
        isNewScene,
        ...stage.flush(),
      });
      isNewScene = false;
      dirty = false;
      continue;
    }

    if (cmd.type === 'scene') {
      isNewScene = true;
    }

    stage.apply(cmd, options);
    dirty = true;
  }

  // If there are visuals but no dialogue, emit a single preview frame.
  if (frames.length === 0 && stage.hasVisuals()) {
    frames.push({
      index: 0,
      isNewScene,
      speaker: parsed.commands.length > 0 ? 'Scene Preview' : 'Active Scene',
      text: parsed.commands.length > 0
        ? 'The script updated the stage but did not contain any dialogue lines.'
        : 'This message does not contain any script commands. Displaying inherited state.',
      ...stage.flush(),
    });
  } else if (dirty && stage.hasVisuals()) {
    frames.push({
      index: frames.length,
      isNewScene,
      speaker: 'Scene Preview',
      text: 'The last command only changed the scene or sprite state.',
      ...stage.flush(),
    });
  }

  return frames;
}

// ─── Initial state builder ───────────────────────────────────────────────────

export function getInitialState(
  messagesBackwards: string[],
  options: FrameBuildOptions,
): InitialPlayerState {
  const stage = new StageState(options);

  for (let i = messagesBackwards.length - 1; i >= 0; i--) {
    const parsed = parseScriptFromMessage(messagesBackwards[i]);
    for (const cmd of parsed.commands) {
      stage.apply(cmd, options);
    }
  }

  // flush() strips transient sprite animations so they don't
  // bleed into frame 0 of the next buildFrames() call.
  stage.flush();

  return {
    background: stage.getBackground(),
    backgroundName: stage.getBackgroundName(),
    backgroundSegment: stage.getBackgroundSegment(),
    cameraTransform: stage.getCameraTransform(),
    rememberedOutfits: stage.getRememberedOutfits(),
    sprites: stage.getSpritesMap(),
  };
}

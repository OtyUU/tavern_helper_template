export type HideCommand = {
  type: 'hide';
  raw: string;
  character: string;
};

export type SpritePosition = 'farleft' | 'left' | 'midleft' | 'center' | 'midright' | 'right' | 'farright';
export type CameraTransform = 'closeup' | 'medium';
export type CameraAnimation = 'shake';

export type CameraPreset = 'default' | 'medium' | 'closeup';

/** Intent-level camera state (no px; safe to persist through history replay). */
export type PlayerCameraIntent = {
  /** Always explicit; never undefined. */
  preset: CameraPreset;
  /** Reserved for future horizontal pans. Stage-relative (% of stage width). */
  panXPct?: number;
  /** Reserved for future vertical pans. Stage-relative (% of stage height). */
  panYPct?: number;
};

export type ShowCommand = {
  type: 'show';
  raw: string;
  character: string;
  /** Explicit outfit from "in <outfit>", if present */
  outfit?: string;
  blush?: boolean;
  /** Raw transform tokens from "at <t1>, <t2>, ..." */
  transforms?: string[];
  tokens: string[];
};

export type CameraCommand = {
  type: 'camera';
  raw: string;
  /** Bare `camera` clears the persistent camera transform and any pending camera animations */
  clear: boolean;
  /** Raw transform tokens from `camera at <t1>, <t2>, ...` */
  transforms?: string[];
};

export type SceneCommand = {
  type: 'scene';
  raw: string;
  background: string;
  /** Optional day/time segment (e.g., "day", "night") */
  segment?: string;
};

export type HideAllCommand = {
  type: 'hide-all';
  raw: string;
};

export type DialogueCommand = {
  type: 'dialogue';
  raw: string;
  speaker: string;
  text: string;
};

export type ScriptCommand = SceneCommand | ShowCommand | HideCommand | HideAllCommand | CameraCommand | DialogueCommand;

export type SpriteState = {
  /** Sprite id (currently the character name) */
  id: string;
  character: string;
  position: SpritePosition;
  /** Current outfit for this sprite */
  outfit?: string;
  pose?: string;
  expression?: string;
  blush?: boolean;
  asset?: PlayerAsset;
  /** One-shot sprite animations applied for the next emitted frame (cleared after flush) */
  animations?: string[];
};

export type InitialPlayerState = {
  /** Active background asset */
  background?: PlayerAsset;
  /** Active background name (for inheritance) */
  backgroundName?: string;
  /** Active background segment (for inheritance) */
  backgroundSegment?: string;
  /** Persistent camera intent (new). */
  camera?: PlayerCameraIntent;
  /** Persistent global camera zoom */
  cameraTransform?: CameraTransform;
  /** Remembered outfit per character, used when `show` omits `in <outfit>` (may include non-visible characters) */
  rememberedOutfits: Record<string, string>;
  sprites: Record<string, SpriteState>;
};

export type ParsedScript = {
  source: 'fenced' | 'message' | 'none';
  scriptText: string;
  commands: ScriptCommand[];
  ignoredLines: string[];
};

export type PlayerAsset = {
  candidates: string[];
  description: string;
};

export type PlayerFrame = {
  index: number;
  /** True when this frame is emitted immediately after processing at least one `scene` command */
  isNewScene?: boolean;
  background?: PlayerAsset;
  /** Camera intent (new). */
  camera?: PlayerCameraIntent;
  cameraTransform?: CameraTransform;
  /** One-shot camera animations for this frame (not persistent) */
  cameraAnimations?: CameraAnimation[];
  /** Render order (DOM order): later entries appear on top */
  sprites: Array<{
    id: string;
    position: SpritePosition;
    asset?: PlayerAsset;
    outfit?: string;
    pose?: string;
    expression?: string;
    blush?: boolean;
    animations?: string[];
  }>;
  speaker?: string;
  text?: string;
};

export type CharacterSpriteConfig = {
  defaultOutfit?: string;
  poseTokens?: string[];
  referenceHeight?: number;
};

export type FrameBuildOptions = {
  assetRoot: string;
  assetExtensions: string[];
  characterSpriteConfig: Record<string, CharacterSpriteConfig>;
  defaultPose: string;
  defaultExpression: string;
  globalPoseTokens: string[];
  initialState?: InitialPlayerState;
};

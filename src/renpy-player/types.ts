export type HideCommand = {
  type: 'hide';
  raw: string;
  character: string;
};

export type SpritePosition = 'left' | 'center' | 'right';
export type CameraTransform = 'closeup' | 'medium';
export type CameraAnimation = 'shake';

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

export type DialogueCommand = {
  type: 'dialogue';
  raw: string;
  speaker: string;
  text: string;
};

export type ScriptCommand = SceneCommand | ShowCommand | HideCommand | CameraCommand | DialogueCommand;

export type SpriteState = {
  /** Sprite id (currently the character name) */
  id: string;
  character: string;
  position: SpritePosition;
  /** Current outfit for this sprite (only for outfit_pose layout) */
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

export type SpriteOffset = { x?: number; y?: number };

export type CharacterSpriteConfig = {
  layout?: 'outfit_pose' | 'flat';
  defaultOutfit?: string;
  poseTokens?: string[];
  referenceHeight?: number;
  baseOffset?: SpriteOffset;
  poseOffsets?: Record<string, SpriteOffset>;
};

export type FrameBuildOptions = {
  assetRoot: string;
  assetExtensions: string[];
  characterSpriteConfig: Record<string, CharacterSpriteConfig>;
  defaultSpriteLayout: 'outfit_pose' | 'flat';
  defaultPose: string;
  defaultExpression: string;
  globalPoseTokens: string[];
  initialState?: InitialPlayerState;
};

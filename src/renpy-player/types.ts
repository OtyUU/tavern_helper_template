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
  /** True if "blush" keyword was present */
  blush?: boolean;
  /** Raw transform tokens from "at <t1>, <t2>, ..." */
  transforms?: string[];
  /** Remaining pose/expression candidate tokens (after stripping in/at/blush) */
  tokens: string[];
};

export type CameraCommand = {
  type: 'camera';
  raw: string;
  /** Bare `camera` clears the persistent zoom state */
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
  /** Sprite key (character name) */
  id: string;
  character: string;
  /** Stage anchor position */
  position: SpritePosition;
  /** Current outfit for this sprite (only for outfit_pose layout) */
  outfit?: string;
  /** Current pose for this visible sprite */
  pose?: string;
  /** Current expression */
  expression?: string;
  /** Current blush state */
  blush?: boolean;
  /** Resolved asset candidates */
  asset?: PlayerAsset;
  /** Active sprite-level animations (e.g., ["shake"]) */
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
  /** Last known outfit per character, even if they're not currently visible */
  rememberedOutfits: Record<string, string>;
  /** Map of active sprites by id */
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
  background?: PlayerAsset;
  cameraTransform?: CameraTransform;
  cameraAnimations?: CameraAnimation[];
  /** Ordered list of sprites to render (order = z-order, last = top) */
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
  layout?: 'outfit_pose' | 'flat';
  defaultOutfit?: string;
  poseTokens?: string[];
};

export type FrameBuildOptions = {
  spriteRoot: string;
  backgroundRoot: string;
  assetExtensions: string[];
  speakerAliases: Record<string, string>;
  characterFolderAliases: Record<string, string>;
  characterSpriteConfig: Record<string, CharacterSpriteConfig>;
  defaultSpriteLayout: 'outfit_pose' | 'flat';
  defaultPose: string;
  defaultExpression: string;
  globalPoseTokens: string[];
  initialState?: InitialPlayerState;
};

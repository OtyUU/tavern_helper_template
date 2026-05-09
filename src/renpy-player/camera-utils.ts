import type { CameraPreset, PlayerCameraIntent, PlayerFrame } from './types';

/**
 * Normalize camera state from a frame during migration.
 * - Prefers frame.camera when present.
 * - Falls back to legacy frame.cameraTransform.
 * - Defaults to { preset: 'default' }.
 */
export function normalizeCameraFromFrame(
  frame: PlayerFrame | null | undefined,
): PlayerCameraIntent {
  if (!frame) return { preset: 'default' };
  if (frame.camera) return frame.camera;
  if (frame.cameraTransform) return { preset: frame.cameraTransform as CameraPreset };
  return { preset: 'default' };
}

/** Intent-only signature for camera motion gating (settings-only values excluded). */
export function cameraSig(intent: PlayerCameraIntent): string {
  return `${intent.preset}|x:${intent.panXPct ?? 0}|y:${intent.panYPct ?? 0}`;
}

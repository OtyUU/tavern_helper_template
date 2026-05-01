import type { InjectionKey } from 'vue';
import type { RenpyPlayerController } from './useRenpyPlayerController';

export const renpyPlayerKey: InjectionKey<RenpyPlayerController> =
  Symbol('renpyPlayer');

export function useRenpyPlayer(): RenpyPlayerController {
  const controller = inject(renpyPlayerKey);
  if (!controller) {
    throw new Error(
      'useRenpyPlayer() must be called inside a component that provides renpyPlayerKey.',
    );
  }
  return controller;
}

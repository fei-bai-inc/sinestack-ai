import { ViggleClient } from './client.js';
import { createCharacterMotionCapabilities } from './character-motion.js';
import { createSceneCapabilities } from './scenes.js';
import { createVideoCapabilities } from './video.js';
import type { ViggleProviderSettings } from './types.js';

export * from './types.js';
export * from './resource-types.js';
export { ViggleClient } from './client.js';
export { ViggleTaskDriver, ViggleAssetModel } from './driver.js';
export type { ViggleHandle, ViggleTaskDefinition } from './driver.js';

/** Viggle's semantic APIs over the same durable task lifecycle as other providers. */
export function createViggleProvider(settings: ViggleProviderSettings = {}) {
  const client = new ViggleClient({ ...settings, headers: { ...settings.headers } });
  return {
    ...createVideoCapabilities(client, settings.fetch ?? globalThis.fetch),
    ...createCharacterMotionCapabilities(client),
    ...createSceneCapabilities(client),
  };
}
export type ViggleProvider = ReturnType<typeof createViggleProvider>;

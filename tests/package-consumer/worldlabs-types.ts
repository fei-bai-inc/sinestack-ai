import { generateAsset, startAsset, waitForAsset } from '@sinestack/ai-core';
import type { GenerateAssetResult } from '@sinestack/ai-core';
import type { AssetModelV1 } from '@sinestack/ai-provider';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';
import type { WorldLabsWorldInput, WorldLabsMediaReference, WorldLabsPreparedUpload, WorldLabsOperation } from '@sinestack/ai-worldlabs';

declare function expectType<T>(value: T): void;
const worldlabs = createWorldLabsProvider();
const model: AssetModelV1<WorldLabsWorldInput, 'gaussian-splat'> = worldlabs.world('unseen-model-version');
const image: WorldLabsMediaReference = { source: 'uri', uri: 'https://example.test/image.png' };

export async function checkInstalledWorldLabsTypes() {
  const input: WorldLabsWorldInput = { world_prompt: { type: 'multi-image', multi_image_prompt: [{ content: image, azimuth: 0 }, { content: { source: 'media_asset', media_asset_id: 'media-one' }, azimuth: 180 }], reconstruct_images: true }, future_parameter: { enabled: true } };
  expectType<GenerateAssetResult<'gaussian-splat'>>(await generateAsset({ model, input }));
  const { operation } = await startAsset({ model, input });
  expectType<GenerateAssetResult<'gaussian-splat'>>(await waitForAsset({ model, operation }));
  expectType<GenerateAssetResult<'image'>>(await generateAsset({ model: worldlabs.depthToPanorama(), input: { depth_pano_image: image, text_prompt: 'Garden', z_min: 0.1, z_max: 10 } }));
  expectType<GenerateAssetResult<'gaussian-splat'>>(await generateAsset({ model: worldlabs.exportSplat(), input: { world_id: 'world-one', resolution: 'full_res' } }));
  expectType<GenerateAssetResult<'model-3d'>>(await generateAsset({ model: worldlabs.exportMesh(), input: { world_id: 'world-one', mesh_variant: 'textured' } }));
  const mapped = worldlabs.world('future-model', { mapInput: (value: { description: string; seed: number }) => ({ world_prompt: { type: 'text', text_prompt: value.description }, seed: value.seed }) });
  await generateAsset({ model: mapped, input: { description: 'Garden', seed: 1 } });
  const prepared: WorldLabsPreparedUpload = await worldlabs.mediaAssets.prepareUpload({ file_name: 'image.png', kind: 'image' });
  expectType<void>(await worldlabs.mediaAssets.upload(prepared, new Uint8Array([1])));
  expectType<WorldLabsOperation>(await worldlabs.operations.get('operation-one'));
  expectType<number>((await worldlabs.credits.get()).remaining_credits);
  // @ts-expect-error The public factory requires a selected native model.
  worldlabs.world();
  // @ts-expect-error Native prompt requirements survive packaging.
  await generateAsset({ model, input: { world_prompt: { type: 'text' } } });
  // @ts-expect-error Reference discriminator requires a URI for source=uri.
  await generateAsset({ model, input: { world_prompt: { type: 'image', image_prompt: { source: 'uri', media_asset_id: 'one' } } } });
  // @ts-expect-error Mapped input inference preserves required fields.
  await generateAsset({ model: mapped, input: { description: 'Garden' } });
  // @ts-expect-error Export variants remain constrained in installed declarations.
  await generateAsset({ model: worldlabs.exportSplat(), input: { world_id: 'world-one', resolution: 'tiny' } });
  // @ts-expect-error Upload requires bytes, not a local file path.
  await worldlabs.mediaAssets.upload(prepared, '/tmp/image.png');
}

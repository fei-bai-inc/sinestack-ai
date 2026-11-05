import { generateAsset, getAssetStatus, startAsset, waitForAsset } from '@sinestack/ai-core';
import type { GenerateAssetResult } from '@sinestack/ai-core';
import type { AssetModelV1 } from '@sinestack/ai-provider';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';
import type { WorldLabsWorldInput, WorldLabsWorldPrompt, WorldLabsMediaReference, WorldLabsDepthToPanoramaInput, WorldLabsExportSplatInput, WorldLabsExportMeshInput, WorldLabsOperation, WorldLabsPreparedUpload } from '@sinestack/ai-worldlabs';

declare function expectType<T>(value: T): void;
const worldlabs = createWorldLabsProvider({ connectionId: 'workspace-one', headers: { 'x-app': 'types' } });
const model = worldlabs.world('future-model-2040');
expectType<AssetModelV1<WorldLabsWorldInput, 'gaussian-splat'>>(model);
expectType<AssetModelV1<WorldLabsDepthToPanoramaInput, 'image'>>(worldlabs.depthToPanorama());
expectType<AssetModelV1<WorldLabsExportSplatInput, 'gaussian-splat'>>(worldlabs.exportSplat());
expectType<AssetModelV1<WorldLabsExportMeshInput, 'model-3d'>>(worldlabs.exportMesh());
const uri: WorldLabsMediaReference = { source: 'uri', uri: 'https://example.test/image.png' };
const media: WorldLabsMediaReference = { source: 'media_asset', media_asset_id: 'uploaded-one' };
const inline: WorldLabsMediaReference = { source: 'data_base64', data_base64: 'aW1hZ2U=', extension: 'png' };
const text: WorldLabsWorldInput = { world_prompt: { type: 'text', text_prompt: 'Garden' }, seed: 0, tags: ['nature'], permission: { public: false }, future: { nested: [true, null, 0] } };
expectType<Promise<GenerateAssetResult<'gaussian-splat'>>>(generateAsset({ model, input: text }));
generateAsset({ model, input: { world_prompt: { type: 'image', image_prompt: uri, is_pano: 'auto', text_prompt: 'Garden', disable_recaption: false } } });
generateAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: [{ content: uri, azimuth: 0 }, { content: media, azimuth: 180 }, { content: inline }], reconstruct_images: true } } });
generateAsset({ model, input: { world_prompt: { type: 'video', video_prompt: media, text_prompt: null } } });
expectType<Promise<GenerateAssetResult<'image'>>>(generateAsset({ model: worldlabs.depthToPanorama(), input: { depth_pano_image: inline, text_prompt: 'Garden', z_min: 0.1, z_max: 10 } }));
expectType<Promise<GenerateAssetResult<'gaussian-splat'>>>(generateAsset({ model: worldlabs.exportSplat(), input: { world_id: 'world-one', resolution: '500k' } }));
expectType<Promise<GenerateAssetResult<'model-3d'>>>(generateAsset({ model: worldlabs.exportMesh(), input: { world_id: 'world-one', mesh_variant: 'vertex_colored' } }));

// @ts-expect-error World generation always requires an explicit model.
worldlabs.world();
// @ts-expect-error Native world prompts are required.
generateAsset({ model, input: { seed: 0 } });
// @ts-expect-error Text prompt discrimination retains its required text.
generateAsset({ model, input: { world_prompt: { type: 'text' } } });
// @ts-expect-error Image prompts require image_prompt even when text is provided.
generateAsset({ model, input: { world_prompt: { type: 'image', text_prompt: 'Garden' } } });
// @ts-expect-error Video prompts require video_prompt.
generateAsset({ model, input: { world_prompt: { type: 'video', text_prompt: 'Garden' } } });
// @ts-expect-error Multi-image content uses native entries, not bare references.
generateAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: [uri] } } });
// @ts-expect-error Panorama detection permits boolean or auto only.
generateAsset({ model, input: { world_prompt: { type: 'image', image_prompt: uri, is_pano: 'yes' } } });
// @ts-expect-error Known fields retain their types despite forward-compatible JSON fields.
generateAsset({ model, input: { ...text, seed: 'random' } });
// @ts-expect-error URI references require a URI.
const missingUri: WorldLabsMediaReference = { source: 'uri' };
// @ts-expect-error Discrimination does not accept a media ID as a URI reference.
const wrongReference: WorldLabsMediaReference = { source: 'uri', media_asset_id: 'one' };
// @ts-expect-error Uploaded references require a media asset identifier.
const missingMedia: WorldLabsMediaReference = { source: 'media_asset' };
// @ts-expect-error Base64 references require inline data.
const missingData: WorldLabsMediaReference = { source: 'data_base64', extension: 'png' };
// @ts-expect-error Unknown source variants are not valid references.
const unknownSource: WorldLabsMediaReference = { source: 'file', uri: 'image.png' };
// @ts-expect-error Depth generation requires text guidance.
generateAsset({ model: worldlabs.depthToPanorama(), input: { depth_pano_image: uri } });
// @ts-expect-error Export requires a source world ID.
generateAsset({ model: worldlabs.exportSplat(), input: { resolution: '100k' } });
// @ts-expect-error Export resolution is a documented native union.
generateAsset({ model: worldlabs.exportSplat(), input: { world_id: 'one', resolution: 'low' } });
// @ts-expect-error Mesh variants are a documented native union.
generateAsset({ model: worldlabs.exportMesh(), input: { world_id: 'one', mesh_variant: 'wireframe' } });

function inspectPrompt(prompt: WorldLabsWorldPrompt) {
  if (prompt.type === 'text') expectType<string>(prompt.text_prompt);
  if (prompt.type === 'image') expectType<WorldLabsMediaReference>(prompt.image_prompt);
  if (prompt.type === 'multi-image') expectType<WorldLabsMediaReference>(prompt.multi_image_prompt[0]!.content);
  if (prompt.type === 'video') expectType<WorldLabsMediaReference>(prompt.video_prompt);
}
function inspectReference(reference: WorldLabsMediaReference) {
  if (reference.source === 'uri') expectType<string>(reference.uri);
  if (reference.source === 'media_asset') expectType<string>(reference.media_asset_id);
  if (reference.source === 'data_base64') expectType<string>(reference.data_base64);
}
const mapped = worldlabs.world<{ description: string; variation: number }>('future-model', {
  mapInput: input => ({ world_prompt: { type: 'text', text_prompt: input.description }, seed: input.variation }),
  mapResult: output => ({ assets: [{ type: 'url', url: 'https://example.test/output.spz', mediaType: 'application/octet-stream' }], providerMetadata: { app: { output } } }),
});
generateAsset({ model: mapped, input: { description: 'Garden', variation: 1 } });
// @ts-expect-error NoInfer prevents custom required input fields from being erased.
generateAsset({ model: mapped, input: { description: 'Garden' } });
const inferred = worldlabs.world('future-model', { mapInput: (input: { caption: string; seed: number }) => ({ world_prompt: { type: 'text', text_prompt: input.caption }, seed: input.seed }) });
expectType<AssetModelV1<{ caption: string; seed: number }, 'gaussian-splat'>>(inferred);
// @ts-expect-error Callback inference retains the seed requirement.
generateAsset({ model: inferred, input: { caption: 'Garden' } });
const mappedExport = worldlabs.exportMesh<{ source: string }>({ mapInput: input => ({ world_id: input.source }) });
generateAsset({ model: mappedExport, input: { source: 'world-one' } });
// @ts-expect-error Export mappings also retain custom input requirements.
generateAsset({ model: mappedExport, input: { world_id: 'world-one' } });

async function resourcesAndResume() {
  const { operation } = await startAsset({ model, input: text });
  await getAssetStatus({ model, operation });
  expectType<GenerateAssetResult<'gaussian-splat'>>(await waitForAsset({ model, operation }));
  expectType<WorldLabsOperation>(await worldlabs.operations.get('operation-one'));
  const worlds = await worldlabs.worlds.list({ page_size: 10, model: 'future-model', tags: ['garden'], is_public: false });
  expectType<string | null | undefined>(worlds.next_page_token);
  expectType<number>((await worldlabs.credits.get()).remaining_credits);
  const prepared: WorldLabsPreparedUpload = await worldlabs.mediaAssets.prepareUpload({ file_name: 'garden.png', kind: 'image', metadata: { tag: 'garden' } });
  expectType<void>(await worldlabs.mediaAssets.upload(prepared, new Blob(['image'])));
  expectType<void>(await worldlabs.mediaAssets.upload(prepared, new Uint8Array([1])));
  expectType<string>((await worldlabs.mediaAssets.get('media-one')).media_asset_id);
  expectType<boolean>((await worldlabs.worlds.delete('world-one')).deleted);
  // @ts-expect-error Upload accepts actual bytes, not a URL string.
  await worldlabs.mediaAssets.upload(prepared, 'https://example.test/file.png');
  // @ts-expect-error Media kind is not an arbitrary string.
  await worldlabs.mediaAssets.prepareUpload({ file_name: 'file.mp3', kind: 'audio' });
  // @ts-expect-error Preparing an upload requires the native filename.
  await worldlabs.mediaAssets.prepareUpload({ kind: 'video' });
}

import type { AssetFile, AssetModelV1Result, JSONObject } from '@sinestack/ai-provider';
import { httpURL, jsonObject, mapAssetResult, record } from '@sinestack/ai-provider-utils';
import { worldRecord } from './client.js';

function file(value: unknown, role: string, metadata: JSONObject, mediaType?: string): AssetFile | undefined {
  if (value == null) return undefined;
  const url = httpURL(value, 'World Labs asset URL').href;
  const mapped = mapAssetResult(url).assets[0]!;
  return { ...mapped, role, metadata, ...(mediaType ? { mediaType } : {}) };
}
export function worldAssets(output: JSONObject): AssetModelV1Result {
  const world = worldRecord(output);
  const assets = record(world.assets, 'World Labs world assets');
  const splats = record(assets.splats, 'World Labs splats');
  const urls = record(splats.spz_urls, 'World Labs SPZ URLs');
  const semantics = splats.semantics_metadata == null ? undefined : jsonObject(splats.semantics_metadata, 'World Labs splat semantics');
  if (semantics) for (const key of ['metric_scale_factor', 'ground_plane_offset']) {
    if (semantics[key] != null && (typeof semantics[key] !== 'number' || !Number.isFinite(semantics[key]))) throw new TypeError(`Invalid ${key}`);
  }
  const files: AssetFile[] = [];
  const resolutions = ['full_res', ...Object.keys(urls).filter(key => key !== 'full_res')];
  for (const resolution of resolutions) {
    const asset = file(urls[resolution], 'splat', { source: `assets.splats.spz_urls.${resolution}`, resolution,
      ...(semantics ? { semantics_metadata: semantics } : {}) }, 'application/octet-stream');
    if (asset) files.push(asset);
  }
  if (!files.length) throw new TypeError('World Labs returned no primary gaussian-splat file');
  if (assets.mesh != null) {
    const mesh = record(assets.mesh, 'World Labs mesh assets');
    for (const [key, role] of [['hq_mesh_url', 'model'], ['full_res_mesh_url', 'model'], ['collider_mesh_url', 'collider']] as const) {
      const asset = file(mesh[key], role, { source: `assets.mesh.${key}` });
      if (asset) files.push(asset);
    }
  }
  if (assets.imagery != null) {
    const image = file(record(assets.imagery, 'World Labs imagery').pano_url, 'panorama', { source: 'assets.imagery.pano_url' });
    if (image) files.push(image);
  }
  const thumbnail = file(assets.thumbnail_url, 'preview', { source: 'assets.thumbnail_url' });
  if (thumbnail) files.push(thumbnail);
  return { assets: files };
}
export function panoramaAssets(output: JSONObject): AssetModelV1Result {
  const panorama = file(output.pano_url, 'panorama', { source: 'pano_url' });
  if (!panorama) throw new TypeError('World Labs returned no panorama file');
  return { assets: [panorama] };
}
export function exportAssets(output: JSONObject, kind: 'splat' | 'mesh'): AssetModelV1Result {
  const format = kind === 'splat' ? 'ply' : 'glb';
  if (output.asset_type !== (kind === 'splat' ? 'splats' : 'mesh') || output.format !== format) throw new TypeError('World Labs export asset type or format mismatch');
  const asset = file(output.url, kind === 'splat' ? 'splat' : 'model', { source: 'url', format,
    ...(output.resolution == null ? {} : { resolution: output.resolution }),
    ...(output.mesh_variant == null ? {} : { mesh_variant: output.mesh_variant }) }, kind === 'splat' ? 'application/octet-stream' : 'model/gltf-binary');
  if (!asset) throw new TypeError('World Labs returned no exported file');
  return { assets: [asset] };
}

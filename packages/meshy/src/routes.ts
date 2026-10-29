/** Provider-local resource routing, not a cross-provider business operation catalog. */
export const meshyRoutes = Object.freeze({
  'text-to-3d': 'v2/text-to-3d',
  'image-to-3d': 'v1/image-to-3d',
  'multi-image-to-3d': 'v1/multi-image-to-3d',
  retexture: 'v1/retexture',
  remesh: 'v1/remesh',
  convert: 'v1/convert',
  resize: 'v1/resize',
  'uv-unwrap': 'v1/uv-unwrap',
  rigging: 'v1/rigging',
  animations: 'v1/animations',
  'text-to-motion': 'v1/text-to-motion',
  'text-to-image': 'v1/text-to-image',
  'image-to-image': 'v1/image-to-image',
  'print/multi-color': 'v1/print/multi-color',
  'print/analyze': 'v1/print/analyze',
  'print/repair': 'v1/print/repair',
  'print/split': 'v1/print/split',
} as const);
export type MeshyTaskFamily = keyof typeof meshyRoutes;
export function familyRoute(family: MeshyTaskFamily): string {
  if (!Object.hasOwn(meshyRoutes, family)) throw new TypeError(`Unsupported Meshy task family: ${family}`);
  return meshyRoutes[family];
}
export function validateRoute(path: string): string {
  if (typeof path !== 'string' || !/^v[1-9]\d*(?:\/[a-z][a-z0-9-]*)+$/.test(path)) throw new TypeError('Invalid Meshy API route');
  return path;
}

import type { AssetModelV1CallOptions, AssetResponse, JSONObject, TaskCallOptions } from '@sinestack/ai-provider';
import type {
  MeshyAssetModel, MeshyAssetStartResult, MeshyClient, MeshyProvider, MeshyTaskDeletion,
  MeshyTaskDriver, MeshyTaskRecord, MeshyTaskResponse, MeshyTaskStartResult,
} from '@sinestack/ai-meshy';

// Compile actual API calls against independently versioned installed tarballs.
// Required headers and native task IDs must survive public declaration emission.
export async function checkMeshyRead(client: MeshyClient) {
  const result = await client.getTask('v1/rigging', 'task');
  const contract: MeshyTaskResponse = result;
  const response: AssetResponse = result.response;
  const headers: Record<string, string> = result.response.headers;
  const task: MeshyTaskRecord = result.data;
  return { contract, response, headers, task };
}

export async function checkMeshyDelete(provider: MeshyProvider) {
  const result = await provider.tasks.delete('rigging', 'task');
  const contract: MeshyTaskDeletion = result;
  const response: AssetResponse = result.response;
  const headers: Record<string, string> = result.response.headers;
  const status: 'deleted' = result.status;
  const taskId: string = result.taskId;
  return { contract, response, headers, status, taskId };
}

export async function checkMeshyDomainStart(model: MeshyTaskDriver<JSONObject, { riggable: boolean }, 'model3d.rig.check'>, options: TaskCallOptions<JSONObject>) {
  const result = await model.doStart(options);
  const contract: MeshyTaskStartResult = result;
  const headers: Record<string, string> = result.response.headers;
  const handleId: string = result.handle.taskId;
  const metadataId: string = result.providerMetadata.meshy.taskId;
  return { contract, headers, handleId, metadataId };
}

export async function checkMeshyAssetStart(model: MeshyAssetModel<JSONObject, 'model-3d'>, options: AssetModelV1CallOptions<JSONObject>) {
  const result = await model.doStart(options);
  const contract: MeshyAssetStartResult = result;
  const headers: Record<string, string> = result.response.headers;
  const handleId: string = result.operation.taskId;
  const metadataId: string = result.providerMetadata.meshy.taskId;
  return { contract, headers, handleId, metadataId };
}

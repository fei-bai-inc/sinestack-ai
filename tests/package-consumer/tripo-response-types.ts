import type { AssetResponse, JSONValue } from '@sinestack/ai-provider';
import type { TripoClient } from '@sinestack/ai-tripo';

// Compile against installed tarballs with independent dependency versions. The
// request response must remain portable and preserve its required headers field.
export function checkTripoResponse(result: Awaited<ReturnType<TripoClient['request']>>) {
  const response: AssetResponse = result.response;
  const headers: Record<string, string> = result.response.headers;
  const data: JSONValue = result.data;
  return { response, headers, data };
}

import { httpURL, jsonObject } from '@sinestack/ai-provider-utils';
import { TripoClient, taskId } from './client.js';
import type { TripoRequestOptions } from './client.js';

export interface TripoPresignedUpload { readonly presigned_url: string; readonly file_token: string; readonly expires_in: number }
export function resources(client: TripoClient) {
  return {
    tasks: {
      async get(id: string, options?: TripoRequestOptions) { return (await client.getTask(id, options)).data; },
      async batch(ids: readonly string[], options?: TripoRequestOptions) {
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new TypeError('Batch query requires 1 to 100 task IDs');
        const requested = ids.map(taskId);
        const result = await client.request('tasks/list', 'POST', options, { task_ids: requested });
        const data = jsonObject(result.data, 'Tripo batch result');
        const tasks = jsonObject(data.tasks, 'Tripo batch tasks');
        if (!Array.isArray(data.missed) || !data.missed.every(id => typeof id === 'string' && requested.includes(id))) throw new TypeError('Invalid missed task IDs');
        for (const [id, value] of Object.entries(tasks)) {
          if (!requested.includes(id) || jsonObject(value, 'Tripo batch task').task_id !== id) throw new TypeError('Tripo batch task identity mismatch');
        }
        return { tasks, missed: data.missed as string[] };
      },
    },
    account: {
      async balance(options?: TripoRequestOptions) {
        const { data } = await client.request('account/balance', 'GET', options);
        const value = jsonObject(data, 'Tripo balance');
        if (typeof value.balance !== 'number' || typeof value.frozen !== 'number' || !Number.isFinite(value.balance) || !Number.isFinite(value.frozen)) throw new TypeError('Invalid Tripo balance');
        return { balance: value.balance, frozen: value.frozen, raw: value };
      },
      async usage(query: Readonly<Record<string, string | number | undefined>> = {}, options?: TripoRequestOptions) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
        return (await client.request(`account/usage${params.size ? `?${params}` : ''}`, 'GET', options)).data;
      },
    },
    files: {
      async upload(file: Blob, filename: string, options?: TripoRequestOptions) {
        if (!(file instanceof Blob) || !file.size || typeof filename !== 'string' || !filename.trim()) throw new TypeError('A nonempty Blob and filename are required');
        const form = new FormData(); form.append('file', file, filename);
        const { data } = await client.request('files', 'POST', options, form);
        const value = jsonObject(data, 'Tripo uploaded file');
        if (typeof value.file_token !== 'string' || !value.file_token) throw new TypeError('Missing file_token');
        return { fileToken: value.file_token };
      },
      async presign(format: string, options?: TripoRequestOptions): Promise<TripoPresignedUpload> {
        if (!/^[a-zA-Z0-9]+$/.test(format)) throw new TypeError('format must be a file extension without a dot');
        const { data } = await client.request('files/presign', 'POST', options, { format });
        const value = jsonObject(data, 'Tripo presign');
        if (typeof value.presigned_url !== 'string' || typeof value.file_token !== 'string' || !value.file_token ||
          typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new TypeError('Invalid presigned upload');
        httpURL(value.presigned_url, 'Presigned URL');
        return value as unknown as TripoPresignedUpload;
      },
      async put(upload: TripoPresignedUpload, file: Blob, options: Pick<TripoRequestOptions, 'abortSignal'> = {}) {
        if (typeof upload.file_token !== 'string' || !upload.file_token) throw new TypeError('Missing upload file_token');
        const url = httpURL(upload.presigned_url, 'Presigned upload URL');
        if (url.protocol !== 'https:') throw new TypeError('Presigned uploads require HTTPS');
        if (!(file instanceof Blob) || !file.size) throw new TypeError('A nonempty upload Blob is required');
        options.abortSignal?.throwIfAborted();
        // Deliberately NOT the credentialed transport. Never inherit API key or caller headers.
        const response = await client.fetcher(url.href, { method: 'PUT', body: file, signal: options.abortSignal,
          headers: { 'Content-Type': 'application/octet-stream' }, redirect: 'error', credentials: 'omit' });
        if (response.redirected || (response.url && response.url !== url.href) || !response.ok) throw new Error(`Presigned upload failed: HTTP ${response.status}`);
        return { fileToken: upload.file_token };
      },
    },
  };
}

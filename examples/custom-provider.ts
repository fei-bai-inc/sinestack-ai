/**
 * A local document provider using the same executor as remote asset models.
 * No API key, network request, queue, or second execution engine is required.
 * Copyright 2026 SineStack AI contributors.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateAsset, materializeAsset } from '@sinestack/ai-core';
import type { AssetModelV1 } from '@sinestack/ai-provider';

interface DocumentInput {
  readonly title: string;
  readonly body: string;
}

export const textDocumentModel: AssetModelV1<DocumentInput, 'document'> = {
  specificationVersion: 'v1',
  provider: 'local',
  modelId: 'utf8-text-document',
  kind: 'document',
  capabilities: { idempotentGenerate: true },

  async doGenerate({ input, abortSignal }) {
    abortSignal.throwIfAborted();
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new TypeError('Document title must be a nonempty string');
    }
    if (typeof input.body !== 'string' || !input.body.trim()) {
      throw new TypeError('Document body must be a nonempty string');
    }
    const data = new TextEncoder().encode(`${input.title}\n\n${input.body}\n`);
    return {
      assets: [{
        type: 'binary',
        data,
        mediaType: 'text/plain; charset=utf-8',
        filename: 'document.txt',
        role: 'document',
      }],
    };
  },
};

const result = await generateAsset({
  model: textDocumentModel,
  input: {
    title: 'SineStack AI 自定义能力示例',
    body: 'document 与 3D、音效共用 generateAsset 的生命周期；provider 只返回一次操作的结果。',
  },
  timeoutMs: 5_000,
  hooks: {
    onStart({ kind }) {
      console.log(`Starting ${kind}`);
    },
    onFinish({ kind }) {
      console.log(`Finished ${kind}`);
    },
  },
});

const file = await materializeAsset(result.asset);
console.log(new TextDecoder().decode(file.uint8Array));

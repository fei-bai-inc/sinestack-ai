/**
 * Public asset APIs adapted from AI SDK 7.0.155's video generation APIs.
 * Copyright 2023 Vercel, Inc. Copyright 2026 SineStack AI contributors.
 * Modified: arbitrary asset kinds and typed inputs share one executor.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Animation3DInput, AssetModelV1, AssetModelV1CancelResult, AssetOperation, MusicInput, SoundEffectInput, ThreeDInput } from '@sinestack/ai-provider';
import { AssetExecutionError } from './errors.js';
import { attempt, completed, execute, observeWebhook, query, submissionHeaders, submit, wait } from './internal/executor.js';
import { httpURL, milliseconds } from './internal/validation.js';
import type {
  AssetOperationOptions, AssetPollOptions, GenerateAssetOptions, GenerateAssetResult,
  GetAssetStatusResult, StartAssetOptions, StartAssetResult, WaitForAssetOptions,
} from './types.js';

function validatePoll(poll?: AssetPollOptions): void {
  milliseconds(poll?.intervalMs, 'poll.intervalMs', true);
  milliseconds(poll?.timeoutMs, 'poll.timeoutMs');
  if (poll?.delay !== undefined && typeof poll.delay !== 'function') throw new TypeError('poll.delay must be a function');
}

export function generateAsset<INPUT, KIND extends string>(options: GenerateAssetOptions<INPUT, KIND>): Promise<GenerateAssetResult<KIND>> {
  return execute('generateAsset', options.model, options, async ctx => {
    validatePoll(options.poll);
    if (options.execution !== undefined && !['auto', 'async', 'direct'].includes(options.execution)) throw new TypeError('Unsupported asset execution mode');
    const { model } = options;
    const hasAsync = model.doStart !== undefined && model.doStatus !== undefined;
    const useAsync = options.execution === 'async' || (options.execution !== 'direct' && hasAsync && (
      options.poll !== undefined || options.webhook !== undefined || model.doGenerate === undefined
    ));
    if (useAsync) {
      if (!hasAsync) throw new AssetExecutionError('This asset model does not support asynchronous execution', { code: 'ASSET_UNSUPPORTED' });
      let webhookUrl: string | undefined;
      let received: Promise<unknown> | undefined;
      if (options.webhook) {
        if (model.capabilities?.webhooks === true) {
          ctx.phase = 'webhook';
          const webhook = await options.webhook();
          // Observe the receiver before validating the URL or starting a job.
          received = observeWebhook(webhook.received);
          ctx.signal.throwIfAborted();
          webhookUrl = httpURL(webhook.url, 'Webhook URL').toString();
        } else {
          ctx.warnings.push({ type: 'other', message: 'The model does not support webhooks; using polling without invoking the webhook factory.' });
        }
      }
      await submit(ctx, options.input, options.providerOptions ?? {}, webhookUrl);
      return await wait(ctx, options.poll, received);
    }
    if (!model.doGenerate) throw new AssetExecutionError('This asset model does not support direct generation', { code: 'ASSET_UNSUPPORTED' });
    if (options.poll || options.webhook) ctx.warnings.push({ type: 'other', message: 'Polling and webhooks are unavailable for direct generation.' });
    const submission = submissionHeaders(ctx.headers);
    const result = await attempt(ctx, 'generate', ctx.signal, () => model.doGenerate!({
      input: options.input, providerOptions: options.providerOptions ?? {},
      abortSignal: ctx.signal, ...submission, headers: { ...submission.headers },
    }));
    return completed(ctx, result);
  });
}

export function startAsset<INPUT, KIND extends string>(options: StartAssetOptions<INPUT, KIND>): Promise<StartAssetResult<KIND>> {
  return execute('startAsset', options.model, options, async ctx => {
    if (options.webhookUrl !== undefined) {
      httpURL(options.webhookUrl, 'Webhook URL');
      if (options.model.capabilities?.webhooks !== true) throw new AssetExecutionError('This model does not support webhook submission', { code: 'ASSET_UNSUPPORTED' });
    }
    return await submit(ctx, options.input, options.providerOptions ?? {}, options.webhookUrl);
  });
}

/** A single status observation and its permitted retries. Never submits. */
export function getAssetStatus<INPUT, KIND extends string>(options: AssetOperationOptions<INPUT, KIND>): Promise<GetAssetStatusResult<KIND>> {
  return execute('getAssetStatus', options.model, options, async ctx => {
    return await query(ctx, ctx.signal);
  }, options.operation);
}

/** Resume waiting on a previously persisted operation. Never submits. */
export function waitForAsset<INPUT, KIND extends string>(options: WaitForAssetOptions<INPUT, KIND>): Promise<GenerateAssetResult<KIND>> {
  const received = options.webhook ? observeWebhook(options.webhook) : undefined;
  return execute('waitForAsset', options.model, options, async ctx => {
    validatePoll(options.poll);
    return await wait(ctx, options.poll, received);
  }, options.operation);
}

/** Explicit remote cancellation. Local AbortSignal cancellation never calls this automatically. */
export function cancelAsset<INPUT, KIND extends string>(options: AssetOperationOptions<INPUT, KIND>): Promise<AssetModelV1CancelResult & { operation: AssetOperation<KIND> }> {
  return execute('cancelAsset', options.model, options, async ctx => {
    if (!options.model.doCancel) throw new AssetExecutionError('This model does not support remote cancellation', { code: 'ASSET_UNSUPPORTED', operation: ctx.operation });
    const result = await attempt(ctx, 'cancel', ctx.signal, () => options.model.doCancel!({
      operation: ctx.operation!.operation, headers: { ...ctx.headers }, abortSignal: ctx.signal,
    }));
    if (!result || !['requested', 'cancelled'].includes(result.status)) throw new TypeError('Invalid cancellation acknowledgement');
    return { ...result, operation: ctx.operation! };
  }, options.operation);
}

type DomainOptions<INPUT, KIND extends string> = Omit<GenerateAssetOptions<INPUT, KIND>, 'input'> & INPUT;

/** A kind-only facade. Native input is passed intact to generateAsset. */
export function generate3D<INPUT>(options: GenerateAssetOptions<INPUT, 'model-3d'>): Promise<GenerateAssetResult<'model-3d'>>;
/** @deprecated Use { model, input }. Flattened fields are for explicitly mapped models only. */
export function generate3D(options: DomainOptions<ThreeDInput, 'model-3d'>): Promise<GenerateAssetResult<'model-3d'>>;
export function generate3D<INPUT>(options: GenerateAssetOptions<INPUT, 'model-3d'> | DomainOptions<ThreeDInput, 'model-3d'>): Promise<GenerateAssetResult<'model-3d'>> {
  if (options.model.kind !== 'model-3d') return Promise.reject(new TypeError('generate3D requires a model-3d asset model'));
  if ('input' in options) return generateAsset(options);
  const { prompt, ...rest } = options;
  return generateAsset({ ...rest, input: { prompt } });
}

/** A kind-only facade. Native input is passed intact to generateAsset. */
export function generateSoundEffect<INPUT>(options: GenerateAssetOptions<INPUT, 'sound-effect'>): Promise<GenerateAssetResult<'sound-effect'>>;
/** @deprecated Use { model, input }. Flattened fields are for explicitly mapped models only. */
export function generateSoundEffect(options: DomainOptions<SoundEffectInput, 'sound-effect'>): Promise<GenerateAssetResult<'sound-effect'>>;
export function generateSoundEffect<INPUT>(options: GenerateAssetOptions<INPUT, 'sound-effect'> | DomainOptions<SoundEffectInput, 'sound-effect'>): Promise<GenerateAssetResult<'sound-effect'>> {
  if (options.model.kind !== 'sound-effect') return Promise.reject(new TypeError('generateSoundEffect requires a sound-effect asset model'));
  if ('input' in options) return generateAsset(options);
  const { prompt, durationSeconds, promptInfluence, loop, ...rest } = options;
  return generateAsset({ ...rest, input: { prompt, durationSeconds, promptInfluence, loop } });
}

/** A kind-only facade. Native input is passed intact to generateAsset. */
export function generateMusic<INPUT>(options: GenerateAssetOptions<INPUT, 'music'>): Promise<GenerateAssetResult<'music'>>;
/** @deprecated Use { model, input }. Flattened fields are for explicitly mapped models only. */
export function generateMusic(options: DomainOptions<MusicInput, 'music'>): Promise<GenerateAssetResult<'music'>>;
export function generateMusic<INPUT>(options: GenerateAssetOptions<INPUT, 'music'> | DomainOptions<MusicInput, 'music'>): Promise<GenerateAssetResult<'music'>> {
  if (options.model.kind !== 'music') return Promise.reject(new TypeError('generateMusic requires a music asset model'));
  if ('input' in options) return generateAsset(options);
  const { prompt, lyrics, instrumental, ...rest } = options;
  return generateAsset({ ...rest, input: { prompt, lyrics, instrumental } });
}

/** A kind-only facade. Native input is passed intact to generateAsset. */
export function generateAnimation3D<INPUT>(options: GenerateAssetOptions<INPUT, 'animation-3d'>): Promise<GenerateAssetResult<'animation-3d'>>;
/** @deprecated Use { model, input }. Flattened fields are for explicitly mapped models only. */
export function generateAnimation3D(options: DomainOptions<Animation3DInput, 'animation-3d'>): Promise<GenerateAssetResult<'animation-3d'>>;
export function generateAnimation3D<INPUT>(options: GenerateAssetOptions<INPUT, 'animation-3d'> | DomainOptions<Animation3DInput, 'animation-3d'>): Promise<GenerateAssetResult<'animation-3d'>> {
  if (options.model.kind !== 'animation-3d') return Promise.reject(new TypeError('generateAnimation3D requires an animation-3d asset model'));
  if ('input' in options) return generateAsset(options);
  const { prompt, durationSeconds, seed, format, ...rest } = options;
  return generateAsset({ ...rest, input: { prompt, durationSeconds, seed, format } });
}

export type { DomainOptions };

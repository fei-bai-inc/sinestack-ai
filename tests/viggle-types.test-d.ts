import { generateAsset, startAsset, waitForAsset, startTask, waitForTask } from '@sinestack/ai-core';
import type { GenerateAssetResult } from '@sinestack/ai-core';
import type { AssetFile, AssetOperation } from '@sinestack/ai-provider';
import { createViggleProvider } from '@sinestack/ai-viggle';

declare function expectType<T>(value: T): void;
declare const imageFile: Blob;
declare const videoFile: Blob;
const viggle = createViggleProvider({ connectionId: 'project-one' });

expectType<Promise<GenerateAssetResult<'video'>>>(generateAsset({
  model: viggle.textToVideo(),
  input: {
    prompt: 'A paper airplane', quality: 'high', duration_s: 5.5, resolution: '2k',
    aspect_ratio: '16:9', seed: 0, watermark: false, enhance: false, priority: 0,
    future_parameter: { option: true },
  },
}));
generateAsset({ model: viggle.firstFrameToVideo(), input: { prompt: 'Wave', quality: 'low', first_frame_image: imageFile } });
generateAsset({ model: viggle.firstLastFrameToVideo(), input: {
  prompt: 'Move between the poses', quality: 'high', first_frame_image_url: 'https://example.test/a.png', last_frame_image: imageFile,
} });
generateAsset({ model: viggle.referenceToVideo(), input: {
  prompt: 'Use these references', quality: 'low', reference_video: videoFile,
  reference_image: [imageFile], reference_image_url: ['https://example.test/ref.png'],
} });
generateAsset({ model: viggle.characterAnimation(), input: {
  driving_video_url: 'https://example.test/drive.mp4', character_image_urls: ['https://example.test/a.png', 'https://example.test/b.png'],
  enhance_mode: 'agent', prompt: 'Replace both people', watermark: false,
} });
generateAsset({ model: viggle.characterAnimation(), input: { driving_video: videoFile, character_image: [imageFile] } });
generateAsset({ model: viggle.renderVideo(), input: {
  character_id: 'char_existing', motion_id: 'mot_existing', model: 'future-render-model',
  background_mode: 'transparent', character_mapping: { segment: 'char_existing' },
} });
generateAsset({ model: viggle.renderVideo(), input: { image: imageFile, motion_video_url: 'https://example.test/drive.mp4', background_mode: 'solid', bg_color: '0,255,0' } });
generateAsset({ model: viggle.renderDraft(), input: {
  draft_id: 'draft_ready', upload_completions: [{ upload_handle: 'upload_character', etag: '"etag"' }],
} });
expectType<Promise<GenerateAssetResult<'image'>>>(generateAsset({ model: viggle.image(), input: {
  prompt: 'A ceramic character', n: 2, resolution: '2K', aspect_ratio: '16:9', seed: 0,
  reference_image: [imageFile], reference_image_url: ['https://example.test/ref.png'],
} }));

// @ts-expect-error H3 requires the prompt even when other options are present.
generateAsset({ model: viggle.textToVideo(), input: { quality: 'low' } });
// @ts-expect-error H3 quality is an explicit required choice.
generateAsset({ model: viggle.textToVideo(), input: { prompt: 'x' } });
// @ts-expect-error Known native fields retain numeric types alongside extensions.
generateAsset({ model: viggle.textToVideo(), input: { prompt: 'x', quality: 'low', duration_s: 'five' } });
// @ts-expect-error First-frame generation requires a first-frame source.
generateAsset({ model: viggle.firstFrameToVideo(), input: { prompt: 'x', quality: 'low' } });
// @ts-expect-error A frame slot cannot contain both a Blob and a URL.
generateAsset({ model: viggle.firstFrameToVideo(), input: { prompt: 'x', quality: 'low', first_frame_image: imageFile, first_frame_image_url: 'https://example.test/a.png' } });
// @ts-expect-error First-last generation requires the last frame as well.
generateAsset({ model: viggle.firstLastFrameToVideo(), input: { prompt: 'x', quality: 'low', first_frame_image: imageFile } });
// @ts-expect-error Reference generation must not silently turn into text-only video.
generateAsset({ model: viggle.referenceToVideo(), input: { prompt: 'x', quality: 'low' } });
// @ts-expect-error Animate always requires a driving video.
generateAsset({ model: viggle.characterAnimation(), input: { character_image_urls: ['https://example.test/a.png'] } });
// @ts-expect-error A driving-video slot cannot contain both an upload and a URL.
generateAsset({ model: viggle.characterAnimation(), input: { driving_video: videoFile, driving_video_url: 'https://example.test/a.mp4', character_image: [imageFile] } });
// @ts-expect-error Render requires both a character source and a motion source.
generateAsset({ model: viggle.renderVideo(), input: { image: imageFile } });
// @ts-expect-error A render character must have only one source.
generateAsset({ model: viggle.renderVideo(), input: { image: imageFile, character_id: 'char_saved', motion_id: 'mot_saved' } });
// @ts-expect-error Draft submission cannot lose its durable draft identity.
generateAsset({ model: viggle.renderDraft(), input: { upload_completions: [] } });
// @ts-expect-error Images require a prompt.
generateAsset({ model: viggle.image(), input: { n: 2 } });
// @ts-expect-error The image count is a number.
generateAsset({ model: viggle.image(), input: { prompt: 'x', n: 'two' } });

startAsset({ model: viggle.image(), input: { prompt: 'A robot' } }).then(started => {
  expectType<AssetOperation<'image'>>(started.operation);
  expectType<Promise<GenerateAssetResult<'image'>>>(waitForAsset({ model: viggle.image(), operation: started.operation }));
});
startTask({ model: viggle.upscaleVideo(), input: { video: videoFile, watermark: false } }).then(async started => {
  const result = await waitForTask({ model: viggle.upscaleVideo(), task: started.task });
  expectType<AssetFile>(result.result.video);
  expectType<readonly AssetFile[]>(result.result.files);
  expectType<string>(result.result.taskId);
});
// @ts-expect-error Upscale requires one video source.
startTask({ model: viggle.upscaleVideo(), input: { watermark: false } });
// @ts-expect-error Video processing is a task driver, not a new generation model.
generateAsset({ model: viggle.upscaleVideo(), input: { video: videoFile } });

viggle.renders.prepare({
  character: { kind: 'upload', filename: 'character.png', content_type: 'image/png', bytes: 100 },
  motion: { kind: 'official_motion', motion_id: 'official-dance' },
  output: { background_mode: 'transparent', aspect_ratio: 'source' },
}).then(result => expectType<string>(result.draft_id));
viggle.renders.prepare({
  character: { kind: 'asset', asset_id: 'char_saved' },
  motion: { kind: 'asset', asset_id: 'mot_saved' },
});
viggle.renders.upload({
  upload_handle: 'upload_character', url: 'https://uploads.example/character.png?signature=signed', method: 'PUT',
  required_headers: { 'content-type': 'image/png' },
}, imageFile, { abortSignal: new AbortController().signal }).then(result => {
  expectType<string>(result.upload_handle);
  expectType<string | undefined>(result.etag);
});
// @ts-expect-error Signed storage uploads accept Blob data, not a URL to fetch implicitly.
viggle.renders.upload({ upload_handle: 'upload_character', url: 'https://uploads.example/character.png', method: 'PUT' }, 'https://example.test/image.png');
viggle.videos.list({ limit: 20, status: 'ready', cursor: 'opaque' }).then(page => expectType<boolean>(page.has_more));
viggle.credits.get().then(balance => expectType<number>(balance.balance));
viggle.renders.download('render_output').then(result => expectType<string>(result.url));
viggle.renders.events('render_running', { lastEventId: 'event_one' }).then(async events => {
  for await (const event of events) expectType<string>(event.event);
});

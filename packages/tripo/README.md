# @sine-ai/tripo

Tripo HTTP v3 adapter for Sine AI. Native parameter types, independent semantic interfaces,
one shared execution runtime. Source workspace package; not published by this change.

```ts
import { generate3D, processModel3D, checkRigging, rigModel, animateModel } from '@sine-ai/core';
import { createTripoProvider } from '@sine-ai/tripo';

const tripo = createTripoProvider({ apiKey: process.env.TRIPO_API_KEY });
const generated = await generate3D({
  model: tripo.textTo3D(applicationModelVersion),
  input: { prompt: 'A small wooden robot', texture: true, pbr: true },
});
const sourceTaskId = generated.providerMetadata?.tripo?.taskId;
if (typeof sourceTaskId !== 'string') throw new Error('Missing Tripo source task');
const textured = await processModel3D({
  processor: tripo.texture(applicationTextureVersion),
  input: { input: sourceTaskId, texture_prompt: { text: 'painted wood' } },
});
const report = await checkRigging({ checker: tripo.rigCheck(), input: { input: textured.taskId } });
```

The example's versions come from the application. Model/version hints are not allowlists.
Factories requiring a model demand an explicit ID; optional processing versions stay omitted
unless supplied. Native `model` and a factory version cannot conflict. Extra JSON input fields
are preserved. `providerOptions.tripo` can supplement but not overwrite input.

See [TRIPO.md](../../docs/TRIPO.md) for all factories, result contracts, persistence,
uploads, webhook verification and remaining live-integration checks.

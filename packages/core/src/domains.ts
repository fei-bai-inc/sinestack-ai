import type { Model3DProcessor, ModelAnimator, ModelRigger, RigChecker, TaskDriver } from '@sine-ai/provider';
import type { DomainResult, TaskRunOptions } from './task-types.js';
import { runTask } from './tasks.js';

type Options<I, R, D extends string> = Omit<TaskRunOptions<I, R, D>, 'model'>;
async function domain<I, R extends object, D extends string>(api: string, expected: D, model: TaskDriver<I, R, D>, options: Options<I, R, D>, validate?: (result: R) => void): Promise<DomainResult<R, D>> {
  if (!model || model.domain !== expected) throw new TypeError(`${api} requires a ${expected} capability`);
  return runTask(api, model, options, ({ result, execution }) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`${api} returned an invalid domain result`);
    if (Object.hasOwn(result, 'execution')) throw new TypeError('The execution field is reserved for SDK metadata');
    validate?.(result);
    return { ...result, execution };
  });
}
export function processModel3D<I, R extends object>(options: Options<I, R, 'model3d.process'> & { processor: Model3DProcessor<I, R> }): Promise<DomainResult<R, 'model3d.process'>> {
  const { processor, ...rest } = options; return domain('processModel3D', 'model3d.process', processor, rest);
}
export function checkRigging<I, R extends { readonly riggable: boolean }>(options: Options<I, R, 'model3d.rig.check'> & { checker: RigChecker<I, R> }): Promise<DomainResult<R, 'model3d.rig.check'>> {
  const { checker, ...rest } = options; return domain('checkRigging', 'model3d.rig.check', checker, rest, result => {
    if (typeof result.riggable !== 'boolean') throw new TypeError('Rig checks must return a boolean riggable conclusion');
  });
}
export function rigModel<I, R extends object>(options: Options<I, R, 'model3d.rig'> & { rigger: ModelRigger<I, R> }): Promise<DomainResult<R, 'model3d.rig'>> {
  const { rigger, ...rest } = options; return domain('rigModel', 'model3d.rig', rigger, rest);
}
export function animateModel<I, R extends object>(options: Options<I, R, 'model3d.animate'> & { animator: ModelAnimator<I, R> }): Promise<DomainResult<R, 'model3d.animate'>> {
  const { animator, ...rest } = options; return domain('animateModel', 'model3d.animate', animator, rest);
}

import type { TaskDriver } from './tasks.js';

/** A model analysis reports findings; it neither promises nor requires a file. */
export interface Model3DAnalyzer<INPUT, RESULT extends object> extends TaskDriver<INPUT, RESULT, 'model3d.analyze'> {}

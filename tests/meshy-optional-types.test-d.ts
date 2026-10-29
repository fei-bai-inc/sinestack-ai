import { animateModel } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';
const meshy = createMeshyProvider();
animateModel({ animator: meshy.animate(), input: { rig_task_id: 'rig', action_id: 0, post_process: {} } });
animateModel({ animator: meshy.animate(), input: { rig_task_id: 'rig', motion_task_id: 'motion', post_process: { fps: 30 } } });

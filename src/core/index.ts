export type { DispatchError, DispatchResult, FanoutConfig } from './fanout.js';
export { createFanoutEngine, FanoutEngine } from './fanout.js';

export type {
  HandlersState,
  ShutdownConfig,
  ShutdownState,
} from './shutdown.js';
export {
  createShutdownManager,
  defaultShutdownConfig,
  ShutdownManager,
} from './shutdown.js';

export type { MatadorConfig } from './matador.js';
export { createMatador, Matador } from './matador.js';

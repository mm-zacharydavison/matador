export type { DispatchError, DispatchResult, FanoutConfig } from './fanout.js';
export { FanoutEngine } from './fanout.js';

export type {
  HandlersState,
  ShutdownConfig,
  ShutdownState,
} from './shutdown.js';
export { defaultShutdownConfig, ShutdownManager } from './shutdown.js';

export type { MatadorConfig } from './matador.js';
export { Matador } from './matador.js';

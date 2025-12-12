// Decorators
export { OnMatadorEvent, MatadorSubscriber } from './decorators/index.js';

// Module
export { MatadorModule } from './module/index.js';

// Services
export { MatadorService } from './services/index.js';

// Discovery
export { SubscriberDiscoveryService } from './discovery/index.js';

// Types
export type {
  OnMatadorEventOptions,
  MatadorEventHandlerMetadata,
  MatadorModuleOptions,
  MatadorModuleAsyncOptions,
  MatadorOptionsFactory,
  NestMatadorOptions,
} from './types.js';

// Constants (for advanced use cases)
export {
  MATADOR_EVENT_HANDLER,
  MATADOR_EVENT_HANDLERS,
  MATADOR_OPTIONS,
} from './constants.js';

export type { TransportCapabilities } from './capabilities.js';
export {
  hasNativeDeadLetter,
  supportsDeliveryMode,
  supportsDelayedMessages,
} from './capabilities.js';

export type {
  MessageHandler,
  MessageReceipt,
  RabbitMQSendOptions,
  RabbitMQSubscribeOptions,
  SendOptions,
  SubscribeOptions,
  Subscription,
  Transport,
  TransportSendOptions,
  TransportSubscribeOptions,
} from './transport.js';

export type {
  ConnectFn,
  ConnectionManagerConfig,
  ConnectionState,
  DisconnectFn,
  StateChangeCallback,
} from './connection-manager.js';
export {
  ConnectionManager,
  defaultConnectionConfig,
} from './connection-manager.js';

export { LocalTransport } from './local/local-transport.js';

export type { FallbackTransportConfig } from './fallback/fallback-transport.js';
export { FallbackTransport } from './fallback/fallback-transport.js';

export type { RabbitMQTransportConfig } from './rabbitmq/rabbitmq-transport.js';
export {
  RabbitMQTransport,
  createRabbitMQTransport,
} from './rabbitmq/rabbitmq-transport.js';

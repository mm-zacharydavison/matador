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

export { MemoryTransport } from './memory/memory-transport.js';

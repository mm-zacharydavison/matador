// Core
export type {
  DispatchError,
  DispatchResult,
  FanoutConfig,
  HandlersState,
  MatadorConfig,
  ShutdownConfig,
  ShutdownState,
} from './core/index.js';
export {
  createFanoutEngine,
  createMatador,
  createShutdownManager,
  defaultShutdownConfig,
  FanoutEngine,
  Matador,
  ShutdownManager,
} from './core/index.js';

// Types
export type {
  AnySubscriber,
  CreateEnvelopeOptions,
  DeliveryMode,
  Docket,
  Envelope,
  EnvelopePayload,
  Event,
  EventClass,
  EventData,
  EventOptions,
  EventStatic,
  Idempotency,
  Importance,
  Subscriber,
  SubscriberCallback,
  SubscriberDefinition,
  SubscriberOptions,
  SubscriberStub,
  ValidationError,
  ValidationResult,
} from './types/index.js';
export {
  BaseEvent,
  createEnvelope,
  createSubscriber,
  createSubscriberStub,
  invalidResult,
  isSubscriber,
  isSubscriberStub,
  validResult,
} from './types/index.js';

// Transport
export type {
  ConnectFn,
  ConnectionManagerConfig,
  ConnectionState,
  DisconnectFn,
  MessageHandler,
  MessageReceipt,
  RabbitMQSendOptions,
  RabbitMQSubscribeOptions,
  SendOptions,
  StateChangeCallback,
  SubscribeOptions,
  Subscription,
  Transport,
  TransportCapabilities,
  TransportSendOptions,
  TransportSubscribeOptions,
} from './transport/index.js';
export {
  ConnectionManager,
  defaultConnectionConfig,
  hasNativeDeadLetter,
  MemoryTransport,
  supportsDeliveryMode,
  supportsDelayedMessages,
} from './transport/index.js';

// Topology
export type {
  DeadLetterConfig,
  DeadLetterQueueConfig,
  QueueDefinition,
  QueueOptions,
  RetryConfig,
  Topology,
} from './topology/index.js';
export {
  createTopology,
  getDeadLetterQueueName,
  getQualifiedQueueName,
  getRetryQueueName,
  TopologyBuilder,
  TopologyValidationError,
} from './topology/index.js';

// Codec
export type { Codec } from './codec/index.js';
export { CodecDecodeError, createJsonCodec, JsonCodec } from './codec/index.js';

// Schema
export type {
  MatadorSchema,
  RegisterOptions,
  SchemaEntry,
  SchemaIssue,
  SchemaValidationResult,
} from './schema/index.js';
export {
  createSchemaRegistry,
  SchemaError,
  SchemaRegistry,
} from './schema/index.js';

// Retry
export type {
  RetryContext,
  RetryDecision,
  RetryPolicy,
  StandardRetryPolicyConfig,
} from './retry/index.js';
export {
  createRetryPolicy,
  defaultRetryConfig,
  StandardRetryPolicy,
} from './retry/index.js';

// Hooks
export type {
  DecodeErrorContext,
  EnqueueErrorContext,
  EnqueueSuccessContext,
  EnqueueWarningContext,
  HookLogger,
  MatadorHooks,
  WorkerErrorContext,
  WorkerExecuteFn,
  WorkerSuccessContext,
} from './hooks/index.js';
export { createSafeHooks, SafeHooks } from './hooks/index.js';

// Pipeline
export type { PipelineConfig, ProcessResult } from './pipeline/index.js';
export { createPipeline, ProcessingPipeline } from './pipeline/index.js';

// Errors
export type { HasDescription } from './errors/index.js';
export {
  DontRetry,
  DoRetry,
  EventAssertionError,
  hasDescription,
  isAssertionError,
  isDontRetry,
  isDoRetry,
  RetryControlError,
} from './errors/index.js';

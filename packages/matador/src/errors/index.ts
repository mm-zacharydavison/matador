export type { HasDescription } from './has-description.js';
export { hasDescription } from './has-description.js';

export {
  DontRetry,
  DoRetry,
  EventAssertionError,
  isAssertionError,
  isDontRetry,
  isDoRetry,
  RetryControlError,
} from './retry-errors.js';

export {
  // Base class
  MatadorError,
  isMatadorError,

  // Lifecycle errors
  NotStartedError,
  isNotStartedError,
  ShutdownInProgressError,

  // Transport errors
  TransportNotConnectedError,
  isTransportNotConnectedError,
  TransportClosedError,
  TransportSendError,
  AllTransportsFailedError,
  DelayedMessagesNotSupportedError,

  // Schema & configuration errors
  EventNotRegisteredError,
  isEventNotRegisteredError,
  SubscriberNotRegisteredError,
  isSubscriberNotRegisteredError,
  NoSubscribersExistError,
  InvalidSchemaError,
  SubscriberIsStubError,
  MemoryTransportCannotProcessStubError,

  // Queue errors
  QueueNotFoundError,

  // Event validation errors
  InvalidEventError,

  // Message processing errors
  MessageMaybePoisonedError,
  isMessageMaybePoisonedError,
  IdempotentMessageCannotRetryError,
  isIdempotentMessageCannotRetryError,

  // Timeout errors
  TimeoutError,
} from './matador-errors.js';

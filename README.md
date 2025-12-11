# Matador

![image](./assets/logo-small.png)

An opinionated, batteries-included framework for using event transports (e.g. `RabbitMQ`) with a lot of useful conventions built in.

# Vision

Matador aims to provide a ready-to-use framework for dispatching messages and moving work off your API servers onto workers.
It is an _opinionated_ library that may-or-may not suit your expectations about how to work with queues.

You can use it to very quickly set up a framework for your events, with battle-tested conventions, edge-case coverage, and observability baked in.

It works best under the following conditions.

- You want the queue topology to be created and managed for you.
- You are working in a monorepo, where you can easily share code.
- You want a 1:N fanout strategy, where each _subscriber_ receives a unique copy of each event.
- You want `at-least-once` delivery semantics.

These conditions are explained later.

# History

Matador has been used at [MeetsMore Inc](https://meetsmore.com/) for over 2 years to publish, consume, and observe 1,000,000+ successful events per day.

This version of Matador is Matador V2, and was re-written from the ground up using our learnings over that 2 year period.

# Features

- Conventional types for `Event` and `Subscriber`
- Map an event to a list of subscribers that will consume it.
- Each subscriber receives a unique copy of each event that can be individually retried and re-queued.
- Automatically create and manage your queue topology.
- Automatic reconnection when connection drops.
- Async hooks for changing behaviour at runtime.
- Async lifecycle hooks for plugging into your observability platform.
- Required fields enforcing good, observable documentation practices.
- `idempotency` declaration for subscribers, allowing you to indicate if events can be retried safely or not.
- `metadata` separated from event payloads, to clearly separate data used for logic, and data that is just used for debugging.
- Gracefully wait for pending enqueues and subscribers to complete work before shutting down.
- Fallback to a different message broker if enqueuing fails.
- Local broker for executing code locally (useful for fallback).
- Retry control flow errors (`DoRetry` and `DontRetry`), so subscribers can manually dictate retry logic.
- Clear, documented, actionable errors for all error cases.
- Poisoned message detection.

# Getting Started

### Define a MatadorEvent

```ts
export class UserLoggedInEvent extends MatadorEvent {
  static readonly key = 'user.logged-in';                   // The unique event name (used to route events).
  static readonly description = 'Fired when a user logs.';  // A description of when the event is triggered.

  constructor(
    public data: {                                          // The data payload used by business logic.
      userId: string;
      username: string;
    },
    public metadata: {                                      // Additional data helpful for logging or debugging.
      loginMethod: 'email' | 'social'
    }
  ) {
    super();
  }
}
```

### Define a Subscriber

```ts
const detectLoginFraud: Subscriber<UserLoggedInEvent> = {
  name: 'detect-login-fraud',                                           // Unique subscriber name.
  description: 'Send an email if unusual login behaviour is detected.'  // A description of what the subscriber does.
  idempotent: 'no'                                                      // Dictates if the operation can be safely retried.
  targetQueue: 'compliance-jobs-worker'                                 // The queue this subscriber consumes from.
  callback: async (event: EnvelopeOf<UserLoggedIn>) => { /** process event */ }
}
```

### Define a Schema

```ts
const myMatadorSchema = MatadorSchema = {
  [UserLoggedIn.key]: [UserLoggedIn, bind([ detectLoginFraud, logEventToBigQuery ])]
}
```

### Instantiate Matador and send events

```ts
const matador = new Matador({ schema: myMatadorSchema })
```

> TODO: Make sure all required arguments for `new Matador` are included in this example.

```ts
await matador.send(UserLoggedIn, { data: { userId: '123' }, metadata: { loginMethod: 'email' } })
```

> TODO: Check this example syntax is correct.

# Concepts

### `MatadorEvent`

A definition of an event. You extend `MatadorEvent` in order to create the _template_ for your event.

### `Subscriber`

A subscriber defines the logic that will execute when an event is consumed.
It also defines details about the event that are used to _fanout_ the event.

```ts
/**
 * Standard subscriber definition with standard callback.
 */
export interface StandardSubscriber<T extends MatadorEvent> {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** A description of what the event does. */
  readonly description: string

  /** Idempotency declaration for retry handling (non-resumable) */
  readonly idempotent?: 'yes' | 'no' | 'unknown' | undefined;

  /** Route this subscriber's events to a specific queue */
  readonly targetQueue?: string | undefined;

  /** Importance level for monitoring and alerting */
  readonly importance?: Importance | undefined;

  /** Feature flag function to conditionally enable/disable the subscriber */
  readonly enabled?: (() => boolean | Promise<boolean>) | undefined;

  /** Callback function to execute when event is received */
  readonly callback: StandardCallback<T['data']>;
}
```

If you want to reference a subscriber which is defined in another codebase, you can use `SubscriberStub`:

```ts
/**
 * Subscriber stub for multi-codebase scenarios where subscriber implementation
 * is in a remote service. Declares the subscriber contract without providing
 * the callback.
 */
export interface SubscriberStub extends StandardSubscriberOptions {
  /** Human-readable name for the subscriber */
  readonly name: string;

  /** Indicates this is a stub without implementation */
  readonly isStub: true;
}
```

### `Schema`

Defines the mapping of `Events` to `Subscribers`.
```ts
const myMatadorSchema = MatadorSchema = {
  // user.logged-in -> UserLoggedInEvent (class) -> subscribers
  [UserLoggedInEvent.key]: [UserLoggedInEvent, bind([ detectLoginFraud, logEventToBigQuery ])]
}
```

### `Envelope`

Combines both your event data + metadata with a `Docket`.
Subscribers receive an `EnvelopeOf<MyEvent>`, which is an envelope with a `data` and `metadata` field typed according to your `MatadorEvent` subclass.

```ts
/**
 * Message envelope containing the event data and routing/observability metadata.
 * This is the transport-agnostic message format used throughout Matador.
 */
export interface Envelope<T = unknown> {
  /** Unique message ID (UUID v4) */
  readonly id: string;

  /** The event data */
  readonly data: T;

  /** Routing, processing state, and observability metadata */
  readonly docket: Docket;
}

/**
 * Helper type to get the envelope type for a subscriber callback.
 * Extracts the data type from a MatadorEvent and wraps it in an Envelope.
 *
 * @example
 * async callback(envelope: EnvelopeOf<MyEvent>) {
 *   console.log(envelope.data.someField); // Type-safe access
 * }
 */
export type EnvelopeOf<T extends MatadorEvent> = Envelope<T['data']>;
```

### `Docket`

> A docket is a commercial document accompanying shipped goods, detailing its contents.

Contains all metadata about an `Envelope`.

| Property            | Documentation                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Routing**         |                                                                                                                                                                                                                                                        |
| `eventKey`          | Event key for routing                                                                                                                                                                                                                                  |
| `eventDescription`  | Human-readable description of the event (for observability/logging)                                                                                                                                                                                    |
| `targetSubscriber`  | Target subscriber name for 1:1 routing                                                                                                                                                                                                                 |
| `originalQueue`     | Original queue before any dead-letter routing                                                                                                                                                                                                          |
| `scheduledFor`      | Scheduled processing time for delayed messages (ISO 8601 string)                                                                                                                                                                                       |
| **Processing State**|                                                                                                                                                                                                                                                        |
| `attempts`          | Attempt counter managed by Matador (1-based). Incremented on each retry. Used when transport doesn't track attempts.                                                                                                                                   |
| `createdAt`         | When the envelope was first created (ISO 8601 string)                                                                                                                                                                                                  |
| `firstError`        | Error message from first failure (for debugging)                                                                                                                                                                                                       |
| `lastError`         | Error message from most recent failure                                                                                                                                                                                                                 |
| **Observability**   |                                                                                                                                                                                                                                                        |
| `importance`        | Importance level for monitoring                                                                                                                                                                                                                        |
| `correlationId`     | Correlation ID for request tracing                                                                                                                                                                                                                     |
| `metadata`          | Custom metadata provided by the application, includes `universalMetadata` |

### `Fanout`

The practice of taking a single published event and creating `N` concrete events, where `N` is the number of subscribers mapped to that event in your `MatadorSchema`

### `Transport`

A representation of a message broker or event backend. e.g `RabbitMQ`, `BullMQ`, `Temporal`, etc.
Currently, only `RabbitMQ` is supported.

### `Topology`

The structure of queues, exchanges, topics, etc that **Matador** will create and manage.
For RabbitMQ, for example, the topology refers to the exchanges, queues, and bindings of those entities.
**Matador** creates and manages topology for you.

There is a generic `Topology` definition in Matador, which you can use to describe the queues you want in a limited fashion.

Each `Transport` then translates that generic `Topology` into the concrete queues, exchanges, etc.

The topology that **Matador** creates looks like this by default.

![image](./assets/matador-rabbitmq-configuration-simple.drawio.png)

#### Retry Queue

When events fail, they are pushed into the retry queue. They will then be re-delivered after their TTL expires.

#### Unhandled Queue

In **Matador**, _unhandled_ refers to a message that was consumed by a worker but is not in your `MatadorSchema`.
This can happen during deployments, where your publisher has already been deployed, but your consumer has not, and therefore your consumer doesn't know about the event yet.
Since the most common reason for this (99.99% of the time in our experience) is simply deployment timing, _unhandled_ events will be requeued after a TTL. 

> TODO: Specify the TTL.

#### Undeliverable Queue

Undeliverable is a conventional term for messages that could not be successfully processed.
After a configured amount of retries, a message will be sent to the undeliverable queue and left there for inspection.
By default, this queue is not cleared by **Matador**, although there is a default size limit.

> TODO: Specify the default size limit.

### `Codec`

Handles the _encoding_ and _decoding_ of events that are published and consumed.
By default, `JSONCodec` is used, which serializes and de-serializes events using JSON.

You can create other `Codec`s if you wish (for example a `MessagePackCodec`).

When using `RabbitMQ`, `RabbitMQCodec` is used, which still uses `JSONCodec` internally, but uses AMQP headers to store `Docket` information.

### `Config`

> TODO: List all config options and description of each.

### `Hooks`

> TODO: List all hooks and description of each.

### `idempotent`

> In programming, an idempotent operation is one that can be performed multiple times with the same result as if it were done only once.

In **Matador**, `idempotent` has a very close meaning, but ultimately just means that an event is _allowed_ to be retried automatically by **Matador**.

# Why it works this way

Since **Matador** is opinionated, we should explain the rationale behind our choices.

### Sending one message will result in a unique message _per subscriber_.

When you send an event in **Matador**, there is a unique copy of that event sent with different `Docket` details.

This is automatic, and referred to as _fanout_ within **Matador**.

We chose this model because while it results in `N` real events per published event, it allows each real event to be retried and managed individually. A single failed subscriber does not affect any others or result in any additional cognitive complexity about the system.

This however does have the impact of requiring the publisher to know about the subscriber. 
This is easy in a monorepo environment, but for remote subscribers, you can use `SubscriberStub`.

### You are working in a monorepo

While it is possible to use **Matador** outside of a monorepo environment, it is designed to work in a situation where you can easily share code between your applications.
This is because both the _publisher_ and the _consumer_ need to know about the event _schema_ (e.g. which events map to which subscribers).

You can either share the code for your `MatadorSchema`, or you can make your workers simply be different instances of the same codebase (with different configuration).

> TODO: Include example of Matador config that is dynamic (e.g. from marketing-pf)

### You want `at-least-once` delivery.

There are two options for delivery in an event system.

- `at-least-once`: Every message is guaranteed to be delivered once, but may deliver more times in some edge-cases.
- `at-most-once`: Every message is guaranteed to be delivered at most once, but may not be delivered at all in some edge cases.

Any system that promises `exactly-once` is lying to you, because there are always timeout scenarios in a distributed system that mean that there may still be a very small possibility of a message being either delivered multiple times (`at-least-once`) or not at all (`at-most-once`).

The choice essential comes down to when you `ack` a message.

- Before processing: `at-most-once`.
- After processing: `at least-once`.

> TODO: Are these statements correct?

# Logging

> TODO: List all possible logs emitted by Matador.

# Errors

> TODO: List all possible errors emitted by Matador (and description of each)

# Other features

### `universalMetadata`

It is often the case that you want every event to have a consistent set of metadata.
**Matador** provides a hook `loadUniversalMetadata` which you can use to do this.

You can combine this with `asyncLocalStorage` to set session based metadata on your events.

Here is a real world example:

```ts
loadUniversalMetadata: () => {
  const store = asyncLocalStorage?.getStore()
  return {
    timestamp: new Date(),
    correlationId: store?.correlationId || null,
    userId: store?.userId || null,
  }
},
```

### Schema plugins

Sometimes, you want to run a subscriber on every event in your _schema_.
Instead of defining the subscriber mapping for every event, you can use _schema plugins_ to do this:

```ts
const myMatadorSchema = MatadorSchema = installPlugins({
  [UserLoggedInEvent.key]: [UserLoggedInEvent, bind([ detectLoginFraud ])],
  [UserLoggedOutEvent.key]: [UserLoggedOutEvent, bind([])],
  [ChatMessageSent.key]: [ChatMessageSent, bind([ notifyUser ])]
},
  [
    {
      subscriber: uploadEventToBigQuery,
      exclusions: [
        ChatMessageSent.key,
      ],
    },
  ])
```

> TODO: Ensure this is actually possible in Matador V2 and add the functionality if not.

### `DoRetry` & `DontRetry`

Sometimes, your subscribers may want to explicitly control if they should be retried or not.
This is useful in cases where a message is _sometimes_ idempotent, but in certain cases (e.g. error scenarios) it is not.

> TODO: Add an example here.

### `LocalTransport`

Matador includes a `LocalTransport`, which is an in-memory transport that will simply process events on the same machine.
This allows you to develop locally without having a message broker, then simply switch to using an actual message broker when you deploy.

### `MultiTransport`

`MultiTransport` allows you to declare a group of transports, and then switch between them at runtime.

You can also use configure it with `fallbackEnabled` (default: `true`), and if enqueuing a message fails, it can fallback to another queue system (in declared order).

You can combine this with `LocalTransport` to make messages that fail to enqueue execute locally, providing resilience against your message broker being unavailable or timing out.

> TODO: Add example with RabbitMQTransport + LocalTransport

### `enabled()` hook for `Subscriber`

Sometimes, you want to enable / disable subscribers at runtime using feature flags.

Each subscriber accepts and `enabled()` callback, which will be invoked before publishing or consuming an event.

> TODO: Is this true? or does it only disable publishing?
> TODO: Add examples

### `importance`

`importance` is an optional field that allows you to note how critical a subscriber failure is.
This is useful for setting up alerts in your observability platform.

For example, if an analytics event fails, it is likely unimportant, but if a payment related subscriber fails, it warrants investigation and should trigger an alert.

> TODO: Add example.

### Delayed messages

> Delayed messages implementation is dependent on the `Transport` used.

You can optionally delay messages in Matador. This will cause their delivery to be delayed.

When using `RabbitMQTransport`, this is implemented using the [delayed-message-exchange plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange), and you should ensure it is installed in your RabbitMQ instance first.

> Note: Distributed event systems do not have precise delivery timings. The consumption of your event will be dependent on your throughput, and you should not depend on delayed messages for accurate timings.

> TODO: Add example.

# CLI

> TODO: Verify this is the right command.

Matador provides a `cli` utility for quick local testing of your Matador configuration.

```bash
bunx matador cli <path-to-config-file> <path-to-event-file>
```

You can send a quick test event using.

```bash
bunx matador cli send-test-event
```

# matador-nest Implementation Plan

## Overview

`matador-nest` is a NestJS integration package for Matador that enables decorator-based event subscriber registration. It allows NestJS developers to define event handlers using familiar patterns while leveraging Matador's transport-agnostic event processing capabilities.

## Goals

1. Provide `@OnMatadorEvent()` decorator for defining subscriber methods
2. Auto-discover and register subscribers at module initialization
3. Integrate with NestJS dependency injection (inject services into subscriber classes)
4. Support all Matador subscriber options (idempotency, importance, targetQueue, etc.)
5. Expose `Matador` instance through DI for sending events
6. Support both sync and async module configuration

## Package Structure

```
packages/matador-nest/
├── src/
│   ├── index.ts                    # Public exports
│   ├── decorators/
│   │   ├── index.ts
│   │   ├── on-matador-event.decorator.ts   # @OnMatadorEvent()
│   │   └── matador-subscriber.decorator.ts # @MatadorSubscriber() class decorator
│   ├── module/
│   │   ├── index.ts
│   │   ├── matador.module.ts       # MatadorModule (dynamic module)
│   │   ├── matador-core.module.ts  # Core module with providers
│   │   └── matador.interfaces.ts   # Module config interfaces
│   ├── discovery/
│   │   ├── index.ts
│   │   └── subscriber-discovery.service.ts # Discovers decorated methods
│   ├── services/
│   │   ├── index.ts
│   │   └── matador.service.ts      # Injectable wrapper around Matador
│   ├── constants.ts                # Metadata keys
│   └── types.ts                    # Package-specific types
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Core Components

### 1. Decorators

#### `@OnMatadorEvent(eventClass, options?)`

Method decorator that marks a method as an event subscriber.

```typescript
import { OnMatadorEvent } from '@zdavison/matador-nest';
import { UserCreatedEvent, OrderPlacedEvent } from './events';
import { Envelope } from '@zdavison/matador';

@Injectable()
export class NotificationService {
  constructor(private readonly emailService: EmailService) {}

  @OnMatadorEvent(UserCreatedEvent, {
    description: 'Sends welcome email',   // Required: human-readable description
    // name auto-generated as 'NotificationService.onUserCreated'
    idempotent: 'yes',                    // Optional: 'yes' | 'no' | 'unknown' | 'resumable'
    importance: 'should-investigate',     // Optional: importance level
    targetQueue: 'email-worker',          // Optional: route to specific queue
  })
  async onUserCreated(envelope: Envelope<UserCreatedEvent['data']>) {
    await this.emailService.sendWelcome(envelope.data.email);
  }

  @OnMatadorEvent(OrderPlacedEvent, {
    name: 'custom-subscriber-name',       // Optional: override auto-generated name
    description: 'Sends order confirmation email',
  })
  async onOrderPlaced(envelope: Envelope<OrderPlacedEvent['data']>) {
    await this.emailService.sendOrderConfirmation(envelope.data);
  }
}
```

**Implementation:**

```typescript
// decorators/on-matador-event.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { EventClass, SubscriberOptions } from '@zdavison/matador';
import { MATADOR_EVENT_HANDLER } from '../constants';

export interface OnMatadorEventOptions extends SubscriberOptions {
  /** Optional: override auto-generated name (default: ClassName.methodName) */
  name?: string;
  /** Required: human-readable description of what this subscriber does */
  description: string;
}

export interface MatadorEventHandlerMetadata {
  eventClass: EventClass<unknown>;
  options: OnMatadorEventOptions;
  methodName: string;
}

export function OnMatadorEvent<T>(
  eventClass: EventClass<T>,
  options: OnMatadorEventOptions,
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const metadata: MatadorEventHandlerMetadata = {
      eventClass,
      options,
      methodName: String(propertyKey),
    };

    // Store metadata on the method
    SetMetadata(MATADOR_EVENT_HANDLER, metadata)(target, propertyKey, descriptor);

    // Also maintain a list on the class for discovery
    const existingHandlers = Reflect.getMetadata(MATADOR_EVENT_HANDLERS, target.constructor) || [];
    Reflect.defineMetadata(
      MATADOR_EVENT_HANDLERS,
      [...existingHandlers, metadata],
      target.constructor,
    );

    return descriptor;
  };
}
```

#### `@MatadorSubscriber()` (Optional Class Decorator)

Optional class decorator for explicit registration. If not used, any class with `@OnMatadorEvent` methods will be auto-discovered.

```typescript
@MatadorSubscriber()
@Injectable()
export class NotificationService {
  // ...
}
```

### 2. Module Configuration

#### `MatadorModule.forRoot(options)`

Synchronous configuration for simple setups.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { MatadorModule } from '@zdavison/matador-nest';
import { RabbitMQTransport, TopologyBuilder } from '@zdavison/matador';

@Module({
  imports: [
    MatadorModule.forRoot({
      transport: new RabbitMQTransport({ url: 'amqp://localhost' }),
      topology: TopologyBuilder.create()
        .withNamespace('myapp')
        .addQueue('events', { concurrency: 10 })
        .build(),
      consumeFrom: ['events'],
      // events are auto-discovered from @OnMatadorEvent decorators
    }),
  ],
})
export class AppModule {}
```

#### `MatadorModule.forRootAsync(options)`

Async configuration for injecting dependencies (ConfigService, etc.).

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MatadorModule } from '@zdavison/matador-nest';
import { RabbitMQTransport, TopologyBuilder } from '@zdavison/matador';

@Module({
  imports: [
    ConfigModule.forRoot(),
    MatadorModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: new RabbitMQTransport({
          url: config.get('RABBITMQ_URL'),
        }),
        topology: TopologyBuilder.create()
          .withNamespace(config.get('APP_NAME'))
          .addQueue('events', { concurrency: 10 })
          .build(),
        consumeFrom: ['events'],
      }),
    }),
  ],
})
export class AppModule {}
```

### 3. Module Interfaces

```typescript
// module/matador.interfaces.ts
import type {
  Topology,
  Transport,
  MatadorHooks,
  RetryPolicy,
  Codec,
  CheckpointStore,
  EventClass,
  AnySubscriber,
} from '@zdavison/matador';
import type { ModuleMetadata, Type } from '@nestjs/common';

export interface MatadorModuleOptions {
  /** Transport implementation (RabbitMQTransport, LocalTransport, etc.) */
  transport: Transport;

  /** Queue topology configuration */
  topology: Topology;

  /** Queues to consume from (if acting as a consumer) */
  consumeFrom?: string[];

  /** Optional codec (defaults to JsonCodec) */
  codec?: Codec;

  /** Optional retry policy */
  retryPolicy?: RetryPolicy;

  /** Optional lifecycle hooks */
  hooks?: MatadorHooks;

  /** Optional checkpoint store for resumable subscribers */
  checkpointStore?: CheckpointStore;

  /**
   * Shutdown configuration for graceful shutdown behavior.
   */
  shutdownConfig?: {
    /** Time to wait for in-flight messages to complete (default: 30000ms) */
    drainTimeoutMs?: number;
  };

  /**
   * Additional events to register (for events without decorated subscribers).
   * Maps event class to subscriber stubs or external subscribers.
   */
  additionalEvents?: Map<EventClass<unknown>, AnySubscriber[]>;

  /**
   * Whether to auto-start consuming.
   * Default: true
   */
  autoStart?: boolean;

  /**
   * Which NestJS lifecycle hook to start Matador on.
   * - 'onModuleInit': Start when MatadorModule initializes (earliest)
   * - 'onApplicationBootstrap': Start after all modules init (default, recommended)
   *
   * Use 'onModuleInit' if other modules depend on Matador being connected
   * during their own onModuleInit/onApplicationBootstrap hooks.
   *
   * Default: 'onApplicationBootstrap'
   */
  startOn?: 'onModuleInit' | 'onApplicationBootstrap';

  /**
   * Global subscriber options applied to all discovered subscribers.
   */
  globalSubscriberDefaults?: {
    importance?: 'can-ignore' | 'should-investigate' | 'must-investigate';
    idempotent?: 'yes' | 'no' | 'unknown';
  };
}

export interface MatadorModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory: (...args: any[]) => Promise<MatadorModuleOptions> | MatadorModuleOptions;
  useClass?: Type<MatadorOptionsFactory>;
  useExisting?: Type<MatadorOptionsFactory>;
}

export interface MatadorOptionsFactory {
  createMatadorOptions(): Promise<MatadorModuleOptions> | MatadorModuleOptions;
}
```

### 4. Discovery Service

The discovery service scans for decorated methods and builds the schema.

```typescript
// discovery/subscriber-discovery.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import {
  createSubscriber,
  type MatadorSchema,
  type EventClass,
  type Subscriber,
  type Envelope,
} from '@zdavison/matador';
import { MATADOR_EVENT_HANDLER, MATADOR_EVENT_HANDLERS } from '../constants';
import type { MatadorEventHandlerMetadata } from '../decorators';

@Injectable()
export class SubscriberDiscoveryService implements OnModuleInit {
  private schema: MatadorSchema = {};

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit() {
    this.discoverSubscribers();
  }

  private discoverSubscribers() {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') continue;

      const handlers: MatadorEventHandlerMetadata[] =
        Reflect.getMetadata(MATADOR_EVENT_HANDLERS, instance.constructor) || [];

      for (const handler of handlers) {
        this.registerHandler(instance, handler);
      }
    }
  }

  private registerHandler(instance: object, metadata: MatadorEventHandlerMetadata) {
    const { eventClass, options, methodName } = metadata;
    const eventKey = eventClass.key;
    const className = instance.constructor.name;

    // Auto-generate name if not provided: ClassName.methodName
    const subscriberName = options.name ?? `${className}.${methodName}`;

    // Create a subscriber that calls the instance method
    const subscriber = createSubscriber({
      name: subscriberName,
      description: options.description,
      idempotent: options.idempotent,
      importance: options.importance,
      targetQueue: options.targetQueue,
      enabled: options.enabled,
      callback: async (envelope: Envelope<unknown>) => {
        // Call the decorated method on the NestJS-managed instance
        await (instance as Record<string, Function>)[methodName](envelope);
      },
    });

    // Add to schema
    const existing = this.schema[eventKey];
    if (existing) {
      // Add subscriber to existing event entry
      const [existingEventClass, existingSubscribers] = Array.isArray(existing)
        ? existing
        : [existing.eventClass, existing.subscribers];
      this.schema[eventKey] = [existingEventClass, [...existingSubscribers, subscriber]];
    } else {
      // Create new entry
      this.schema[eventKey] = [eventClass, [subscriber]];
    }
  }

  getSchema(): MatadorSchema {
    return this.schema;
  }
}
```

### 5. Matador Service

Injectable service for sending events with proper NestJS lifecycle integration.

```typescript
// services/matador.service.ts
import {
  Injectable,
  Inject,
  OnModuleInit,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  Matador,
  type EventClass,
  type Event,
  type EventOptions,
  type SendResult,
} from '@zdavison/matador';
import { MATADOR_OPTIONS } from '../constants';
import type { MatadorModuleOptions } from '../module/matador.interfaces';
import { SubscriberDiscoveryService } from '../discovery/subscriber-discovery.service';

@Injectable()
export class MatadorService implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private matador!: Matador;
  private isShuttingDown = false;
  private isStarted = false;

  constructor(
    @Inject(MATADOR_OPTIONS) private readonly options: MatadorModuleOptions,
    private readonly discoveryService: SubscriberDiscoveryService,
  ) {
    // Build Matador instance immediately (but don't start yet)
    this.initializeMatador();
  }

  /**
   * Called when MatadorModule is initialized.
   * Starts Matador if startOn === 'onModuleInit'.
   */
  async onModuleInit() {
    if (this.shouldAutoStart() && this.options.startOn === 'onModuleInit') {
      await this.doStart();
    }
  }

  private initializeMatador() {
    const discoveredSchema = this.discoveryService.getSchema();

    // Merge with additional events from config
    const mergedSchema = { ...discoveredSchema };
    if (this.options.additionalEvents) {
      for (const [eventClass, subscribers] of this.options.additionalEvents) {
        const existing = mergedSchema[eventClass.key];
        if (existing) {
          const [, existingSubscribers] = Array.isArray(existing)
            ? existing
            : [existing.eventClass, existing.subscribers];
          mergedSchema[eventClass.key] = [eventClass, [...existingSubscribers, ...subscribers]];
        } else {
          mergedSchema[eventClass.key] = [eventClass, subscribers];
        }
      }
    }

    // Validate schema at startup
    const registry = new SchemaRegistry();
    for (const [key, entry] of Object.entries(mergedSchema)) {
      const [eventClass, subscribers] = Array.isArray(entry)
        ? entry
        : [entry.eventClass, entry.subscribers];
      registry.register(eventClass, subscribers);
    }
    const validation = registry.validate();
    if (!validation.valid) {
      throw new Error(
        `Invalid Matador schema: ${validation.issues.map(i => i.message).join(', ')}`
      );
    }

    this.matador = new Matador(
      {
        transport: this.options.transport,
        topology: this.options.topology,
        schema: mergedSchema,
        consumeFrom: this.options.consumeFrom,
        codec: this.options.codec,
        retryPolicy: this.options.retryPolicy,
        checkpointStore: this.options.checkpointStore,
        shutdownConfig: this.options.shutdownConfig,
      },
      this.options.hooks,
    );
  }

  private shouldAutoStart(): boolean {
    return this.options.autoStart !== false;
  }

  private async doStart() {
    if (this.isStarted) return;
    await this.matador.start();
    this.isStarted = true;
  }

  /**
   * Called after all modules are initialized and the app is ready to start.
   * Starts Matador if startOn === 'onApplicationBootstrap' (default).
   */
  async onApplicationBootstrap() {
    const startOn = this.options.startOn ?? 'onApplicationBootstrap';
    if (this.shouldAutoStart() && startOn === 'onApplicationBootstrap') {
      await this.doStart();
    }
  }

  /**
   * Called when the application receives a shutdown signal (SIGTERM, etc).
   * Stop accepting new messages and wait for in-flight messages to complete.
   */
  async beforeApplicationShutdown(signal?: string) {
    this.isShuttingDown = true;

    // Wait for in-flight messages to complete (with configurable timeout)
    const timeoutMs = this.options.shutdownConfig?.drainTimeoutMs ?? 30000;
    await this.matador.waitForIdle(timeoutMs);
  }

  /**
   * Called after beforeApplicationShutdown completes.
   * Disconnect from transport and clean up resources.
   */
  async onApplicationShutdown(signal?: string) {
    await this.matador.shutdown();
  }

  /**
   * Send an event to all registered subscribers.
   * Throws if called during shutdown.
   */
  async send<T>(
    eventClass: EventClass<T>,
    data: T,
    options?: EventOptions,
  ): Promise<SendResult>;
  async send<T>(event: Event<T>, options?: EventOptions): Promise<SendResult>;
  async send<T>(
    eventOrClass: EventClass<T> | Event<T>,
    dataOrOptions?: T | EventOptions,
    options?: EventOptions,
  ): Promise<SendResult> {
    if (this.isShuttingDown) {
      throw new Error('Cannot send events during shutdown');
    }
    return this.matador.send(eventOrClass as EventClass<T>, dataOrOptions as T, options);
  }

  /**
   * Get the underlying Matador instance for advanced operations.
   */
  getMatador(): Matador {
    return this.matador;
  }

  /**
   * Start consuming (if autoStart was false).
   */
  async start(): Promise<void> {
    return this.matador.start();
  }

  /**
   * Check if connected to transport.
   */
  isConnected(): boolean {
    return this.matador.isConnected();
  }

  /**
   * Check if shutdown is in progress.
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Wait for all pending messages to be processed.
   */
  async waitForIdle(timeoutMs?: number): Promise<boolean> {
    return this.matador.waitForIdle(timeoutMs);
  }
}
```

### 6. Dynamic Module

```typescript
// module/matador.module.ts
import { DynamicModule, Module, Global } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MatadorService } from '../services/matador.service';
import { SubscriberDiscoveryService } from '../discovery/subscriber-discovery.service';
import { MATADOR_OPTIONS } from '../constants';
import type { MatadorModuleOptions, MatadorModuleAsyncOptions } from './matador.interfaces';

@Global()
@Module({})
export class MatadorModule {
  static forRoot(options: MatadorModuleOptions): DynamicModule {
    return {
      module: MatadorModule,
      imports: [DiscoveryModule],
      providers: [
        {
          provide: MATADOR_OPTIONS,
          useValue: options,
        },
        SubscriberDiscoveryService,
        MatadorService,
      ],
      exports: [MatadorService],
    };
  }

  static forRootAsync(options: MatadorModuleAsyncOptions): DynamicModule {
    return {
      module: MatadorModule,
      imports: [DiscoveryModule, ...(options.imports || [])],
      providers: [
        {
          provide: MATADOR_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        SubscriberDiscoveryService,
        MatadorService,
      ],
      exports: [MatadorService],
    };
  }
}
```

## Advanced Features

### 1. Resumable Subscribers

Support for checkpoint-based idempotency:

```typescript
import { OnMatadorEvent, SubscriberContext } from '@zdavison/matador-nest';

@Injectable()
export class OrderService {
  @OnMatadorEvent(OrderPlacedEvent, {
    name: 'process-order',
    description: 'Processes order with checkpoints',
    idempotent: 'resumable',
  })
  async processOrder(
    envelope: Envelope<OrderPlacedEvent['data']>,
    context: SubscriberContext,  // Injected when idempotent: 'resumable'
  ) {
    const validated = await context.io('validate', () =>
      this.validateOrder(envelope.data)
    );
    const charged = await context.io('charge', () =>
      this.chargeCustomer(validated)
    );
    await context.io('ship', () =>
      this.shipOrder(charged)
    );
  }
}
```

**Implementation note:** When `idempotent: 'resumable'` is specified, the decorator should use `ResumableCallback` and inject `SubscriberContext` as the second parameter.

### 2. Conditional Subscribers (Feature Flags)

```typescript
@Injectable()
export class AnalyticsService {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  @OnMatadorEvent(UserCreatedEvent, {
    name: 'track-signup',
    description: 'Track user signup in analytics',
  })
  async trackSignup(envelope: Envelope<UserCreatedEvent['data']>) {
    // ...
  }

  // Method referenced by symbol for type-safe feature flag
  @MatadorEnabled(AnalyticsService.prototype.trackSignup)
  isTrackSignupEnabled(): boolean {
    return this.featureFlags.isEnabled('analytics');
  }
}
```

**Problem:** Arrow function in decorator can't access `this` context.

**Solution:** Use a separate `@MatadorEnabled()` decorator that links to the handler method via direct reference:

```typescript
// decorators/matador-enabled.decorator.ts
export function MatadorEnabled<T>(
  handlerMethod: (envelope: Envelope<T>) => Promise<void> | void,
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    // Store a reference from the handler method to this enabled-check method
    const handlerName = handlerMethod.name;
    Reflect.defineMetadata(
      MATADOR_ENABLED_METHOD,
      propertyKey,
      target.constructor,
      handlerName,
    );
    return descriptor;
  };
}
```

This approach:
- Uses direct method reference (refactor-safe)
- TypeScript will error if `trackSignup` is renamed/removed
- Discovery service looks up the enabled method at runtime and binds to instance

**Alternative (simpler):** Don't support `enabled` in the decorator at all. Users can handle conditional logic inside the callback or use Matador's global plugin system with exclusions.

### 3. Testing Support

Provide testing utilities:

```typescript
// testing/matador-testing.module.ts
import { Module } from '@nestjs/common';
import { LocalTransport, TopologyBuilder } from '@zdavison/matador';
import { MatadorModule } from '../module/matador.module';

@Module({})
export class MatadorTestingModule {
  static forTest(overrides?: Partial<MatadorModuleOptions>): DynamicModule {
    return MatadorModule.forRoot({
      transport: new LocalTransport(),
      topology: TopologyBuilder.create()
        .withNamespace('test')
        .addQueue('events')
        .build(),
      consumeFrom: ['events'],
      autoStart: true,
      ...overrides,
    });
  }
}
```

Usage in tests:

```typescript
describe('NotificationService', () => {
  let module: TestingModule;
  let matadorService: MatadorService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [MatadorTestingModule.forTest()],
      providers: [NotificationService],
    }).compile();

    matadorService = module.get(MatadorService);
    await module.init();
  });

  it('sends welcome email on UserCreatedEvent', async () => {
    await matadorService.send(UserCreatedEvent, {
      userId: '123',
      email: 'test@example.com',
      name: 'Test User',
    });

    await matadorService.waitForIdle();

    // Assert email was sent
  });
});
```

## Public API Summary

### Decorators

| Decorator                     | Description                                    |
|-------------------------------|------------------------------------------------|
| `@OnMatadorEvent(event, opts)`| Marks method as event subscriber               |
| `@MatadorSubscriber()`        | Optional: explicitly marks class as subscriber |

### Module

| Method                          | Description                           |
|---------------------------------|---------------------------------------|
| `MatadorModule.forRoot(opts)`   | Sync module configuration             |
| `MatadorModule.forRootAsync()`  | Async module configuration with DI    |
| `MatadorTestingModule.forTest()`| Testing module with LocalTransport    |

### Services

| Service          | Description                                      |
|------------------|--------------------------------------------------|
| `MatadorService` | Injectable service for sending events            |

### MatadorService Methods

| Method                          | Description                                     |
|---------------------------------|-------------------------------------------------|
| `send(eventClass, data, opts?)` | Send event to subscribers                       |
| `send(event, opts?)`            | Send event instance                             |
| `getMatador()`                  | Get underlying Matador instance                 |
| `start()`                       | Start consuming (if autoStart=false)            |
| `isConnected()`                 | Check transport connection                      |
| `isShutdownInProgress()`        | Check if graceful shutdown is in progress       |
| `waitForIdle(timeout?)`         | Wait for pending messages to process            |

### Lifecycle Integration

The `MatadorService` integrates with NestJS lifecycle hooks for graceful startup and shutdown:

| NestJS Hook                  | Matador Action                                          |
|------------------------------|---------------------------------------------------------|
| `OnModuleInit`               | Start consuming (if `startOn: 'onModuleInit'`)          |
| `OnApplicationBootstrap`     | Start consuming (if `startOn: 'onApplicationBootstrap'`, default) |
| `BeforeApplicationShutdown`  | Stop accepting new events, drain in-flight messages     |
| `OnApplicationShutdown`      | Disconnect from transport and clean up resources        |

**Startup options:**
- `startOn: 'onApplicationBootstrap'` (default): Start after all modules are initialized. Recommended for most cases.
- `startOn: 'onModuleInit'`: Start when MatadorModule initializes. Use when other modules depend on Matador being connected during their initialization.

**Graceful shutdown flow:**
1. App receives shutdown signal (SIGTERM, etc.)
2. `beforeApplicationShutdown`: Sets shutdown flag, waits for in-flight messages (configurable `drainTimeoutMs`, default 30s)
3. `onApplicationShutdown`: Calls `matador.shutdown()` to disconnect transport
4. Sending events during shutdown throws an error

## Dependencies

```json
{
  "name": "@zdavison/matador-nest",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@zdavison/matador": "^2.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "tsup": "^8.3.5"
  }
}
```

## Implementation Steps

### Phase 1: Core Foundation

1. **Create package structure**
   - Initialize `packages/matador-nest`
   - Set up `package.json`, `tsconfig.json`, `tsup.config.ts`
   - Configure exports

2. **Implement constants and types**
   - Define metadata keys (`MATADOR_EVENT_HANDLER`, `MATADOR_EVENT_HANDLERS`, `MATADOR_OPTIONS`)
   - Define module option interfaces

3. **Implement `@OnMatadorEvent` decorator**
   - Store metadata on methods
   - Maintain handler list on class

4. **Implement discovery service**
   - Scan providers for decorated methods
   - Build schema from discovered handlers

5. **Implement `MatadorService`**
   - Initialize Matador with discovered schema
   - Expose send/lifecycle methods

6. **Implement `MatadorModule`**
   - `forRoot()` sync configuration
   - `forRootAsync()` async configuration

### Phase 2: Advanced Features

7. **Add resumable subscriber support**
   - Detect `idempotent: 'resumable'`
   - Inject `SubscriberContext` as second parameter

8. **Add `@MatadorEnabled()` decorator** (optional)
   - Link enabled-check method to handler via method reference
   - Discover and bind at runtime

### Phase 3: Testing & Polish

9. **Implement testing module**
    - `MatadorTestingModule.forTest()`
    - LocalTransport defaults

10. **Write unit tests**
    - Decorator metadata extraction
    - Discovery service
    - Module initialization

11. **Write integration tests**
    - Full event flow with NestJS app
    - DI injection into handlers

12. **Documentation**
    - README with examples
    - JSDoc on public APIs

## Decisions

1. **Subscriber naming**: Auto-generate using format `ClassName.methodName`, but allow optional `name` override in decorator options.

2. **Multiple events per handler**: Not supported. One `@OnMatadorEvent` decorator = one event type.

3. **Feature flags (`enabled`)**: Two options:
   - **Option A (recommended for simplicity):** Don't support in decorator. Users handle conditional logic in callback or use Matador's plugin system.
   - **Option B:** Separate `@MatadorEnabled(handlerMethodRef)` decorator with type-safe method reference (refactor-safe).

4. **Schema validation**: Yes, validate discovered schema at startup and fail fast on issues.

5. **Hot reload**: Not supported. Static subscriber registration only.

6. **Scope**: Singleton scope only. Request-scoped providers not supported.

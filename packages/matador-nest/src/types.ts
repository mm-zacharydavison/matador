import type { ModuleMetadata, Type } from '@nestjs/common';
import type {
  AnySubscriber,
  BaseSubscriberOptions,
  EventClass,
  Idempotency,
  MatadorConfig,
  MatadorHooks,
} from '@zdavison/matador';

/**
 * Options for the @OnMatadorEvent decorator.
 * Derived from BaseSubscriberOptions with additional NestJS-specific fields.
 */
export interface OnMatadorEventOptions extends BaseSubscriberOptions {
  /** Optional: override auto-generated name (default: ClassName.methodName) */
  readonly name?: string | undefined;

  /** Idempotency declaration for retry handling */
  readonly idempotent?: Idempotency | undefined;
}

/**
 * Metadata stored on methods decorated with @OnMatadorEvent.
 */
export interface MatadorEventHandlerMetadata {
  readonly eventClass: EventClass<unknown>;
  readonly options: OnMatadorEventOptions;
  readonly methodName: string;
}

/**
 * NestJS-specific options that extend MatadorConfig.
 */
export interface NestMatadorOptions {
  /** Optional lifecycle hooks */
  readonly hooks?: MatadorHooks | undefined;

  /**
   * Additional events to register (for events without decorated subscribers).
   * Maps event class to subscriber stubs or external subscribers.
   */
  readonly additionalEvents?:
    | Map<EventClass<unknown>, AnySubscriber[]>
    | undefined;

  /**
   * Whether to auto-start consuming.
   * Default: true
   */
  readonly autoStart?: boolean | undefined;

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
  readonly startOn?: 'onModuleInit' | 'onApplicationBootstrap' | undefined;

  /**
   * Which NestJS lifecycle hook to shutdown Matador on.
   * - 'onModuleDestroy': Shutdown when MatadorModule is destroyed (earliest)
   * - 'beforeApplicationShutdown': Shutdown before app closes (default, recommended)
   * - 'onApplicationShutdown': Shutdown when app closes (latest)
   *
   * Use 'beforeApplicationShutdown' to ensure Matador finishes processing
   * before other modules start their shutdown.
   *
   * Default: 'beforeApplicationShutdown'
   */
  readonly shutdownOn?:
    | 'onModuleDestroy'
    | 'beforeApplicationShutdown'
    | 'onApplicationShutdown'
    | undefined;

  /**
   * Global subscriber options applied to all discovered subscribers.
   */
  readonly globalSubscriberDefaults?:
    | Pick<BaseSubscriberOptions, 'importance'> & {
        readonly idempotent?: Idempotency | undefined;
      }
    | undefined;
}

/**
 * Configuration options for MatadorModule.
 * Derived from MatadorConfig (minus schema which is auto-generated) plus NestJS-specific options.
 */
export interface MatadorModuleOptions
  extends Omit<MatadorConfig, 'schema'>,
    NestMatadorOptions {}

/**
 * Factory interface for creating MatadorModuleOptions.
 */
export interface MatadorOptionsFactory {
  createMatadorOptions(): Promise<MatadorModuleOptions> | MatadorModuleOptions;
}

/**
 * Async configuration options for MatadorModule.forRootAsync().
 */
export interface MatadorModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly unknown[] | undefined;
  readonly useFactory?: (
    // biome-ignore lint/suspicious/noExplicitAny: Factory can receive any injected dependencies
    ...args: any[]
  ) => Promise<MatadorModuleOptions> | MatadorModuleOptions;
  readonly useClass?: Type<MatadorOptionsFactory> | undefined;
  readonly useExisting?: Type<MatadorOptionsFactory> | undefined;
}

import {
  type DynamicModule,
  Global,
  type InjectionToken,
  Module,
  type Provider,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { MATADOR_OPTIONS } from '../constants.js';
import { SubscriberDiscoveryService } from '../discovery/subscriber-discovery.service.js';
import { MatadorService } from '../services/matador.service.js';
import type {
  MatadorModuleAsyncOptions,
  MatadorModuleOptions,
  MatadorOptionsFactory,
} from '../types.js';

/**
 * NestJS module for integrating Matador event processing.
 *
 * Use `MatadorModule.forRoot()` for synchronous configuration or
 * `MatadorModule.forRootAsync()` for async configuration with dependency injection.
 *
 * @example Synchronous configuration
 * ```typescript
 * @Module({
 *   imports: [
 *     MatadorModule.forRoot({
 *       transport: new RabbitMQTransport({
 *         url: 'amqp://localhost',
 *         connectionName: 'myapp',
 *       }),
 *       topology: TopologyBuilder.create()
 *         .withNamespace('myapp')
 *         .addQueue('events', { concurrency: 10 })
 *         .build(),
 *       consumeFrom: ['events'],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example Async configuration with ConfigService
 * ```typescript
 * @Module({
 *   imports: [
 *     ConfigModule.forRoot(),
 *     MatadorModule.forRootAsync({
 *       imports: [ConfigModule],
 *       inject: [ConfigService],
 *       useFactory: (config: ConfigService) => ({
 *         transport: new RabbitMQTransport({
 *           url: config.get('RABBITMQ_URL'),
 *           connectionName: config.get('APP_NAME'),
 *         }),
 *         topology: TopologyBuilder.create()
 *           .withNamespace(config.get('APP_NAME'))
 *           .addQueue('events')
 *           .build(),
 *         consumeFrom: ['events'],
 *       }),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class MatadorModule {
  /**
   * Configures the MatadorModule with static options.
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   */
  static forRoot(options: MatadorModuleOptions): DynamicModule {
    return {
      module: MatadorModule,
      imports: [DiscoveryModule],
      providers: [
        {
          provide: MATADOR_OPTIONS,
          useValue: options,
        },
        DiscoveryService,
        SubscriberDiscoveryService,
        MatadorService,
      ],
      exports: [MatadorService],
    };
  }

  /**
   * Configures the MatadorModule with async options.
   * Use this when you need to inject dependencies like ConfigService.
   *
   * @param options - Async module configuration options
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: MatadorModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: MatadorModule,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        ...asyncProviders,
        DiscoveryService,
        SubscriberDiscoveryService,
        MatadorService,
      ],
      exports: [MatadorService],
    };
  }

  /**
   * Creates async providers for the module options.
   */
  private static createAsyncProviders(
    options: MatadorModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: MATADOR_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as InjectionToken[],
        },
      ];
    }

    if (options.useClass) {
      return [
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
        {
          provide: MATADOR_OPTIONS,
          useFactory: async (
            factory: MatadorOptionsFactory,
          ): Promise<MatadorModuleOptions> => factory.createMatadorOptions(),
          inject: [options.useClass],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: MATADOR_OPTIONS,
          useFactory: async (
            factory: MatadorOptionsFactory,
          ): Promise<MatadorModuleOptions> => factory.createMatadorOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    throw new Error(
      'MatadorModule.forRootAsync() requires useFactory, useClass, or useExisting',
    );
  }
}

import { type DynamicModule, Module } from '@nestjs/common';
import { LocalTransport, TopologyBuilder } from '@zdavison/matador';
import { MatadorModule } from '../module/matador.module.js';
import type { MatadorModuleOptions } from '../types.js';

/**
 * Testing module for Matador with sensible defaults for unit/integration tests.
 *
 * Uses LocalTransport by default, which processes messages synchronously
 * in-memory without requiring external infrastructure.
 *
 * @example Basic usage
 * ```typescript
 * describe('NotificationService', () => {
 *   let module: TestingModule;
 *   let matadorService: MatadorService;
 *
 *   beforeEach(async () => {
 *     module = await Test.createTestingModule({
 *       imports: [MatadorTestingModule.forTest()],
 *       providers: [NotificationService],
 *     }).compile();
 *
 *     matadorService = module.get(MatadorService);
 *     await module.init();
 *   });
 *
 *   it('processes events', async () => {
 *     await matadorService.send(UserCreatedEvent, { userId: '123' });
 *     await matadorService.waitForIdle();
 *     // Assert expected behavior
 *   });
 * });
 * ```
 *
 * @example With custom overrides
 * ```typescript
 * MatadorTestingModule.forTest({
 *   topology: TopologyBuilder.create()
 *     .withNamespace('custom-test')
 *     .addQueue('my-queue')
 *     .build(),
 *   consumeFrom: ['my-queue'],
 * })
 * ```
 */
@Module({})
export class MatadorTestingModule {
  /**
   * Creates a testing module with LocalTransport and default configuration.
   *
   * @param overrides - Optional overrides for the default configuration
   * @returns Dynamic module configuration
   */
  static forTest(overrides?: Partial<MatadorModuleOptions>): DynamicModule {
    const defaultOptions: MatadorModuleOptions = {
      transport: new LocalTransport(),
      topology: TopologyBuilder.create()
        .withNamespace('test')
        .addQueue('events')
        .build(),
      consumeFrom: ['events'],
      autoStart: true,
    };

    return MatadorModule.forRoot({
      ...defaultOptions,
      ...overrides,
    });
  }
}

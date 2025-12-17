import { Module } from '@nestjs/common';
import { LocalTransport, TopologyBuilder } from '@zdavison/matador';
import { MatadorModule } from '@zdavison/matador-nest';
import { AnalyticsService, NotificationService } from './services/index.js';

/**
 * Main application module.
 *
 * This example uses LocalTransport for demonstration purposes.
 * In production, you would use RabbitMQTransport:
 *
 * ```typescript
 * import { RabbitMQTransport } from '@zdavison/matador';
 *
 * MatadorModule.forRoot({
 *   transport: new RabbitMQTransport({
 *     url: 'amqp://localhost',
 *     connectionName: 'my-app',
 *   }),
 *   // ...
 * })
 * ```
 */
@Module({
  imports: [
    MatadorModule.forRoot({
      // Use LocalTransport for testing/demo - messages are processed in-memory
      transport: new LocalTransport(),

      // Define the queue topology
      topology: TopologyBuilder.create()
        .withNamespace('example-app')
        .addQueue('events', { concurrency: 10 })
        .build(),

      // Consume from the events queue
      consumeFrom: ['events'],

      // Auto-start consuming when the app bootstraps
      autoStart: true,
    }),
  ],
  providers: [
    // These services will have their @OnMatadorEvent decorated methods
    // automatically discovered and registered
    NotificationService,
    AnalyticsService,
  ],
})
export class AppModule {}

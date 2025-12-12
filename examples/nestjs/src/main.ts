import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MatadorService } from '@zdavison/matador-nest';
import { AppModule } from './app.module.js';
import {
  OrderPlacedEvent,
  UserCreatedEvent,
  UserProfileUpdatedEvent,
} from './events/index.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create the NestJS application
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Get the MatadorService to send events
  const matador = app.get(MatadorService);

  logger.log('Application started - sending test events...');

  // Example: Create a new user
  logger.log('\n--- Sending UserCreatedEvent ---');
  await matador.send(UserCreatedEvent, {
    userId: 'user-123',
    email: 'john.doe@example.com',
    name: 'John Doe',
  });

  // Wait for event to be processed
  await matador.waitForIdle();

  // Example: Update user profile
  logger.log('\n--- Sending UserProfileUpdatedEvent ---');
  await matador.send(UserProfileUpdatedEvent, {
    userId: 'user-123',
    changes: {
      bio: 'Software Engineer',
      location: 'San Francisco',
    },
  });

  await matador.waitForIdle();

  // Example: Place an order
  logger.log('\n--- Sending OrderPlacedEvent ---');
  await matador.send(OrderPlacedEvent, {
    orderId: 'order-456',
    userId: 'user-123',
    items: [
      { productId: 'prod-1', quantity: 2, price: 29.99 },
      { productId: 'prod-2', quantity: 1, price: 49.99 },
    ],
    total: 109.97,
  });

  await matador.waitForIdle();

  logger.log('\n--- All events processed! ---');

  // Graceful shutdown
  await app.close();
}

bootstrap().catch((error) => {
  console.error('Application failed to start:', error);
  process.exit(1);
});

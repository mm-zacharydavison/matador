/**
 * Example Matador configuration for CLI testing
 *
 * This file demonstrates how to structure a config file for the CLI.
 * It exports:
 *   - schema: MatadorSchema mapping event keys to event classes and subscribers
 *   - topology: Topology configuration
 */

import {
  MatadorEvent,
  type MatadorSchema,
  type Topology,
  TopologyBuilder,
  createSubscriber,
} from '../src/index.js';

// ============================================================================
// Events
// ============================================================================

export class UserCreatedEvent extends MatadorEvent {
  static readonly key = 'user.created';
  static readonly description = 'Fired when a new user is created';

  constructor(
    public data: {
      userId: string;
      email: string;
      name: string;
    },
  ) {
    super();
  }
}

export class OrderPlacedEvent extends MatadorEvent {
  static readonly key = 'order.placed';
  static readonly description = 'Fired when a new order is placed';

  constructor(
    public data: {
      orderId: string;
      userId: string;
      amount: number;
      items: Array<{ productId: string; quantity: number }>;
    },
  ) {
    super();
  }
}

// ============================================================================
// Subscribers
// ============================================================================

const sendWelcomeEmail = createSubscriber({
  name: 'send-welcome-email',
  description: 'Sends a welcome email to newly registered users',
  callback: async ({ data, docket }) => {
    console.log(`  📧 Sending welcome email to ${data.email}`);
    console.log(`     User: ${data.name} (${data.userId})`);
    if (docket.correlationId) {
      console.log(`     Correlation ID: ${docket.correlationId}`);
    }
  },
  idempotent: 'yes',
  importance: 'should-investigate',
});

const trackUserAnalytics = createSubscriber({
  name: 'track-user-analytics',
  description: 'Tracks user creation in analytics system',
  callback: async ({ data }) => {
    console.log(`  📊 Tracking analytics for new user: ${data.userId}`);
  },
  idempotent: 'yes',
  importance: 'can-ignore',
});

const processOrder = createSubscriber({
  name: 'process-order',
  description: 'Processes order for fulfillment',
  callback: async ({ data }) => {
    console.log(`  📦 Processing order ${data.orderId}`);
    console.log(`     Amount: $${data.amount.toFixed(2)}`);
    console.log(`     Items: ${data.items.length} item(s)`);
  },
  idempotent: 'no',
  importance: 'must-investigate',
});

const sendOrderConfirmation = createSubscriber({
  name: 'send-order-confirmation',
  description: 'Sends order confirmation email to customer',
  callback: async ({ data }) => {
    console.log(`  📧 Sending order confirmation for ${data.orderId}`);
  },
  idempotent: 'yes',
  importance: 'should-investigate',
});

// ============================================================================
// Exports
// ============================================================================

/**
 * Matador schema mapping event keys to event classes and their subscribers.
 * Uses the tuple format: [EventClass, Subscribers[]]
 */
export const schema: MatadorSchema = {
  [UserCreatedEvent.key]: [
    UserCreatedEvent,
    [sendWelcomeEmail, trackUserAnalytics],
  ],
  [OrderPlacedEvent.key]: [
    OrderPlacedEvent,
    [processOrder, sendOrderConfirmation],
  ],
};

export const topology: Topology = TopologyBuilder.create()
  .withNamespace('example')
  .addQueue('events', { concurrency: 5 })
  .withoutDeadLetter()
  .build();

/**
 * Example Matador configuration for CLI testing
 *
 * This file demonstrates how to structure a config file for the CLI.
 * It exports:
 *   - events: Map of event keys to event classes
 *   - subscribers: Map of event keys to subscriber arrays
 *   - topology: (optional) Custom topology configuration
 */

import {
  type AnySubscriber,
  MatadorEvent,
  type EventClass,
  type Topology,
  createSubscriber,
  createTopology,
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

const sendWelcomeEmail = createSubscriber('send-welcome-email',
  async (data, docket) => {
    console.log(`  📧 Sending welcome email to ${data.email}`);
    console.log(`     User: ${data.name} (${data.userId})`);
    if (docket.correlationId) {
      console.log(`     Correlation ID: ${docket.correlationId}`);
    }
  },
  { idempotent: 'yes', importance: 'should-investigate' },
);

const trackUserAnalytics = createSubscriber('track-user-analytics',
  async (data) => {
    console.log(`  📊 Tracking analytics for new user: ${data.userId}`);
  },
  { idempotent: 'yes', importance: 'can-ignore' },
);

const processOrder = createSubscriber('process-order',
  async (data) => {
    console.log(`  📦 Processing order ${data.orderId}`);
    console.log(`     Amount: $${data.amount.toFixed(2)}`);
    console.log(`     Items: ${data.items.length} item(s)`);
  },
  { idempotent: 'no', importance: 'must-investigate' },
);

const sendOrderConfirmation = createSubscriber('send-order-confirmation',
  async (data) => {
    console.log(`  📧 Sending order confirmation for ${data.orderId}`);
  },
  { idempotent: 'yes', importance: 'should-investigate' },
);

// ============================================================================
// Exports
// ============================================================================

export const events: Record<string, EventClass> = {
  [UserCreatedEvent.key]: UserCreatedEvent,
  [OrderPlacedEvent.key]: OrderPlacedEvent,
};

export const subscribers: Record<string, AnySubscriber[]> = {
  [UserCreatedEvent.key]: [sendWelcomeEmail, trackUserAnalytics],
  [OrderPlacedEvent.key]: [processOrder, sendOrderConfirmation],
};

export const topology: Topology = createTopology()
  .withNamespace('example')
  .addQueue('events', { concurrency: 5 })
  .withoutDeadLetter()
  .build();

import { Injectable, Logger } from '@nestjs/common';
import type { Envelope } from '@zdavison/matador';
import { OnMatadorEvent } from '@zdavison/matador-nest';
import { OrderPlacedEvent, UserCreatedEvent } from '../events/index.js';

/**
 * Service that handles notification-related event subscriptions.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  /**
   * Sends a welcome email when a new user signs up.
   */
  @OnMatadorEvent(UserCreatedEvent, {
    description: 'Sends welcome email to newly created users',
    idempotent: 'yes',
    importance: 'should-investigate',
  })
  async sendWelcomeEmail(
    envelope: Envelope<UserCreatedEvent['data']>,
  ): Promise<void> {
    const { userId, email, name } = envelope.data;

    this.logger.log(`Sending welcome email to ${name} <${email}> (${userId})`);

    // Simulate email sending
    await this.simulateEmailSend({
      to: email,
      subject: `Welcome, ${name}!`,
      body: 'Thank you for signing up!',
    });

    this.logger.log(`Welcome email sent successfully to ${email}`);
  }

  /**
   * Sends order confirmation when an order is placed.
   */
  @OnMatadorEvent(OrderPlacedEvent, {
    description: 'Sends order confirmation email',
    idempotent: 'yes',
    importance: 'must-investigate',
  })
  async sendOrderConfirmation(
    envelope: Envelope<OrderPlacedEvent['data']>,
  ): Promise<void> {
    const { orderId, userId, total, items } = envelope.data;

    this.logger.log(
      `Sending order confirmation for order ${orderId} to user ${userId}`,
    );
    this.logger.log(
      `Order total: $${total.toFixed(2)}, items: ${items.length}`,
    );

    // Simulate email sending
    await this.simulateEmailSend({
      to: `user-${userId}@example.com`,
      subject: `Order Confirmation #${orderId}`,
      body: `Your order of ${items.length} items totaling $${total.toFixed(2)} has been confirmed.`,
    });

    this.logger.log(`Order confirmation sent for ${orderId}`);
  }

  private async simulateEmailSend(email: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    // Simulate async email sending
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.logger.debug(`Email sent to ${email.to}: "${email.subject}"`);
  }
}

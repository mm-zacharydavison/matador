import { Injectable, Logger } from '@nestjs/common';
import type { Envelope } from '@zdavison/matador';
import { OnMatadorEvent } from '@zdavison/matador-nest';
import {
  OrderPlacedEvent,
  UserCreatedEvent,
  UserProfileUpdatedEvent,
} from '../events/index.js';

/**
 * Service that handles analytics tracking for various events.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * Tracks user signup in analytics.
   */
  @OnMatadorEvent(UserCreatedEvent, {
    description: 'Tracks user signup in analytics platform',
    idempotent: 'yes',
    importance: 'can-ignore',
  })
  async trackUserSignup(
    envelope: Envelope<UserCreatedEvent['data']>,
  ): Promise<void> {
    const { userId, email } = envelope.data;

    this.logger.log(`Tracking signup for user ${userId}`);

    await this.sendToAnalytics('user_signup', {
      user_id: userId,
      email_domain: email.split('@')[1],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Tracks profile updates in analytics.
   */
  @OnMatadorEvent(UserProfileUpdatedEvent, {
    description: 'Tracks profile updates in analytics platform',
    idempotent: 'yes',
    importance: 'can-ignore',
  })
  async trackProfileUpdate(
    envelope: Envelope<UserProfileUpdatedEvent['data']>,
  ): Promise<void> {
    const { userId, changes } = envelope.data;

    this.logger.log(`Tracking profile update for user ${userId}`);

    await this.sendToAnalytics('profile_updated', {
      user_id: userId,
      fields_changed: Object.keys(changes),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Tracks orders in analytics.
   */
  @OnMatadorEvent(OrderPlacedEvent, {
    description: 'Tracks order placement in analytics platform',
    idempotent: 'yes',
    importance: 'should-investigate',
  })
  async trackOrder(
    envelope: Envelope<OrderPlacedEvent['data']>,
  ): Promise<void> {
    const { orderId, userId, total, items } = envelope.data;

    this.logger.log(`Tracking order ${orderId} in analytics`);

    await this.sendToAnalytics('order_placed', {
      order_id: orderId,
      user_id: userId,
      total_amount: total,
      item_count: items.length,
      timestamp: new Date().toISOString(),
    });
  }

  private async sendToAnalytics(
    event: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    // Simulate sending to analytics platform
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.logger.debug(`Analytics event: ${event}`, properties);
  }
}

import { type JsonRecord, MatadorEvent } from '@zdavison/matador';

/**
 * Event fired when an order is placed.
 */
export class OrderPlacedEvent extends MatadorEvent<{
  orderId: string;
  userId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  total: number;
}> {
  static readonly key = 'order.placed';
  static readonly description = 'Fired when a customer places an order';

  constructor(
    public readonly data: {
      orderId: string;
      userId: string;
      items: Array<{ productId: string; quantity: number; price: number }>;
      total: number;
    },
    public readonly metadata?: JsonRecord,
  ) {
    super();
  }
}

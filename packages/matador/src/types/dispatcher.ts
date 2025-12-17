import type { SendResult } from '../core/fanout.js';
import type { Event, EventClass, EventOptions } from './event.js';

/**
 * Interface for dispatching events.
 * Implemented by Matador to allow subscribers to send events.
 */
export interface Dispatcher {
  /**
   * Sends an event to all registered subscribers.
   */
  send<T>(
    eventClass: EventClass<T>,
    data: T,
    options?: EventOptions,
  ): Promise<SendResult>;
  send<T>(event: Event<T>, options?: EventOptions): Promise<SendResult>;
}

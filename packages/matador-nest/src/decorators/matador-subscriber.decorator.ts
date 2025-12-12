import { Injectable, type Type } from '@nestjs/common';

/**
 * Optional class decorator that marks a class as a Matador subscriber.
 * Classes with @OnMatadorEvent methods are auto-discovered, so this decorator
 * is optional. Use it for explicit documentation or when you want to ensure
 * a class is treated as a subscriber even if it has no decorated methods yet.
 *
 * @example
 * ```typescript
 * @MatadorSubscriber()
 * @Injectable()
 * export class NotificationService {
 *   @OnMatadorEvent(UserCreatedEvent, { description: '...' })
 *   async onUserCreated(envelope: Envelope<...>) {
 *     // ...
 *   }
 * }
 * ```
 */
export function MatadorSubscriber(): ClassDecorator {
  return (target: object): void => {
    // Ensure the class is injectable (apply @Injectable if not already)
    // This is a no-op if @Injectable was already applied
    Injectable()(target as Type<unknown>);
  };
}

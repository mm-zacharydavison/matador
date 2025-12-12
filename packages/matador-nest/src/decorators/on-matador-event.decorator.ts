import type { EventClass } from '@zdavison/matador';
import { MATADOR_EVENT_HANDLER, MATADOR_EVENT_HANDLERS } from '../constants.js';
import type {
  MatadorEventHandlerMetadata,
  OnMatadorEventOptions,
} from '../types.js';

/**
 * Method decorator that marks a method as a Matador event subscriber.
 *
 * @param eventClass - The event class to subscribe to
 * @param options - Subscriber options (description is required)
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class NotificationService {
 *   @OnMatadorEvent(UserCreatedEvent, {
 *     description: 'Sends welcome email to new users',
 *     idempotent: 'yes',
 *   })
 *   async onUserCreated(envelope: Envelope<UserCreatedEvent['data']>) {
 *     await this.emailService.sendWelcome(envelope.data.email);
 *   }
 * }
 * ```
 */
export function OnMatadorEvent<T>(
  eventClass: EventClass<T>,
  options: OnMatadorEventOptions,
): (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const metadata: MatadorEventHandlerMetadata = {
      eventClass: eventClass as EventClass<unknown>,
      options,
      methodName: String(propertyKey),
    };

    // Store metadata on the method itself
    if (descriptor.value != null) {
      Reflect.defineMetadata(
        MATADOR_EVENT_HANDLER,
        metadata,
        descriptor.value as object,
      );
    }

    // Maintain a list of all handlers on the class for discovery
    const existingHandlers: MatadorEventHandlerMetadata[] =
      Reflect.getMetadata(MATADOR_EVENT_HANDLERS, target.constructor) ?? [];

    Reflect.defineMetadata(
      MATADOR_EVENT_HANDLERS,
      [...existingHandlers, metadata],
      target.constructor,
    );

    return descriptor;
  };
}

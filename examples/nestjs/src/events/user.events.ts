import { type JsonRecord, MatadorEvent } from '@zdavison/matador';

/**
 * Event fired when a new user is created.
 */
export class UserCreatedEvent extends MatadorEvent<{
  userId: string;
  email: string;
  name: string;
}> {
  static readonly key = 'user.created';
  static readonly description = 'Fired when a new user signs up';

  constructor(
    public readonly data: {
      userId: string;
      email: string;
      name: string;
    },
    public readonly metadata?: JsonRecord,
  ) {
    super();
  }
}

/**
 * Event fired when a user updates their profile.
 */
export class UserProfileUpdatedEvent extends MatadorEvent<{
  userId: string;
  changes: Record<string, unknown>;
}> {
  static readonly key = 'user.profile.updated';
  static readonly description = 'Fired when a user updates their profile';

  constructor(
    public readonly data: {
      userId: string;
      changes: Record<string, unknown>;
    },
    public readonly metadata?: JsonRecord,
  ) {
    super();
  }
}

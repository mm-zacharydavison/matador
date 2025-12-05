/**
 * Example event file for CLI testing
 *
 * This file demonstrates how to structure an event file for the CLI.
 * It exports:
 *   - eventKey: The key of the event to dispatch (must match an event in config)
 *   - data: The event payload
 *   - before: (optional) Previous state for change events
 *   - options: (optional) Dispatch options like correlationId, metadata
 */

export const eventKey = 'user.created';

export const data = {
  userId: 'usr_12345',
  email: 'alice@example.com',
  name: 'Alice Smith',
};

export const options = {
  correlationId: 'req_abc123',
  metadata: {
    source: 'cli-test',
    timestamp: new Date().toISOString(),
  },
};

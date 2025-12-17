import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '../../hooks/index.js';
import { redactAmqpUrl, RabbitMQTransport } from './rabbitmq-transport.js';

describe('redactAmqpUrl', () => {
  it('should redact username and password with 4 asterisks', () => {
    const url = 'amqp://myuser:mypassword@localhost:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://****:****@localhost:5672');
  });

  it('should redact credentials in amqps URLs', () => {
    const url = 'amqps://admin:secret123@rabbitmq.example.com:5671';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqps://****:****@rabbitmq.example.com:5671');
  });

  it('should redact long credentials to exactly 4 asterisks', () => {
    const url =
      'amqp://verylongusername:verylongpassword@rabbitmq-cluster.svc.local:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://****:****@rabbitmq-cluster.svc.local:5672');
  });

  it('should redact short credentials to exactly 4 asterisks', () => {
    const url = 'amqp://a:b@host:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://****:****@host:5672');
  });

  it('should preserve vhost in URL', () => {
    const url = 'amqp://user:pass@host:5672/myvhost';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://****:****@host:5672/myvhost');
  });

  it('should not modify URL without credentials', () => {
    const url = 'amqp://localhost:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://localhost:5672');
  });

  it('should not modify URL with only username (no password)', () => {
    const url = 'amqp://guest@localhost:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://guest@localhost:5672');
  });

  it('should handle URL-encoded credentials', () => {
    // URL-encoded @ in password: p%40ssword
    const url = 'amqp://user:p%40ssword@host:5672';
    const redacted = redactAmqpUrl(url);
    expect(redacted).toBe('amqp://****:****@host:5672');
  });
});

describe('RabbitMQTransport', () => {
  describe('connection logging', () => {
    it('should log redacted connection URL when connecting', async () => {
      const mockLogger: Logger = {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      };

      const transport = new RabbitMQTransport({
        url: 'amqp://testuser:testpass@localhost:5672',
        logger: mockLogger,
        connection: {
          maxReconnectAttempts: 1, // Only try once to avoid long retries
          initialReconnectDelay: 10,
        },
      });

      // Attempt to connect - it will fail since there's no RabbitMQ server
      // but the log should still be emitted before the connection attempt
      try {
        await transport.connect();
      } catch {
        // Expected to fail - no RabbitMQ server running
      }

      // Verify the log was called with the redacted URL
      expect(mockLogger.info).toHaveBeenCalledWith(
        "[Matador] \u23F3 Connecting to RabbitMQ at 'amqp://****:****@localhost:5672'.",
      );
    });

    it('should log connection URL as-is when no credentials provided', async () => {
      const mockLogger: Logger = {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      };

      const transport = new RabbitMQTransport({
        url: 'amqp://localhost:5672',
        logger: mockLogger,
        connection: {
          maxReconnectAttempts: 1,
          initialReconnectDelay: 10,
        },
      });

      try {
        await transport.connect();
      } catch {
        // Expected to fail
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        "[Matador] \u23F3 Connecting to RabbitMQ at 'amqp://localhost:5672'.",
      );
    });
  });
});

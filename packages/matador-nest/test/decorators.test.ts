import { describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { type Envelope, MatadorEvent } from '@zdavison/matador';
import { MATADOR_EVENT_HANDLERS } from '../src/constants.js';
import { OnMatadorEvent } from '../src/decorators/on-matador-event.decorator.js';

// Test event
class TestEvent extends MatadorEvent<{ userId: string }> {
  static readonly key = 'test.event';
  static readonly description = 'Test event';

  constructor(public readonly data: { userId: string }) {
    super();
  }
}

describe('@OnMatadorEvent decorator', () => {
  it('stores metadata on the class', () => {
    class TestService {
      @OnMatadorEvent(TestEvent, {
        description: 'Test handler',
      })
      async handleTestEvent(_envelope: Envelope<TestEvent['data']>) {
        // handler
      }
    }

    const handlers = Reflect.getMetadata(MATADOR_EVENT_HANDLERS, TestService);

    expect(handlers).toBeDefined();
    expect(handlers).toHaveLength(1);
    expect(handlers[0].eventClass).toBe(TestEvent);
    expect(handlers[0].options.description).toBe('Test handler');
    expect(handlers[0].methodName).toBe('handleTestEvent');
  });

  it('stores multiple handlers on the same class', () => {
    class AnotherEvent extends MatadorEvent<{ data: string }> {
      static readonly key = 'another.event';
      constructor(public readonly data: { data: string }) {
        super();
      }
    }

    class MultiHandlerService {
      @OnMatadorEvent(TestEvent, {
        description: 'Handler 1',
      })
      async handler1(_envelope: Envelope<TestEvent['data']>) {
        // handler
      }

      @OnMatadorEvent(AnotherEvent, {
        description: 'Handler 2',
      })
      async handler2(_envelope: Envelope<AnotherEvent['data']>) {
        // handler
      }
    }

    const handlers = Reflect.getMetadata(
      MATADOR_EVENT_HANDLERS,
      MultiHandlerService,
    );

    expect(handlers).toBeDefined();
    expect(handlers).toHaveLength(2);
    expect(handlers[0].eventClass).toBe(TestEvent);
    expect(handlers[1].eventClass).toBe(AnotherEvent);
  });

  it('supports custom subscriber name', () => {
    class ServiceWithCustomName {
      @OnMatadorEvent(TestEvent, {
        name: 'custom-name',
        description: 'Custom named handler',
      })
      async handleEvent(_envelope: Envelope<TestEvent['data']>) {
        // handler
      }
    }

    const handlers = Reflect.getMetadata(
      MATADOR_EVENT_HANDLERS,
      ServiceWithCustomName,
    );

    expect(handlers[0].options.name).toBe('custom-name');
  });

  it('supports all subscriber options', () => {
    class ServiceWithAllOptions {
      @OnMatadorEvent(TestEvent, {
        description: 'Full options handler',
        idempotent: 'yes',
        importance: 'must-investigate',
        targetQueue: 'priority-queue',
      })
      async handleEvent(_envelope: Envelope<TestEvent['data']>) {
        // handler
      }
    }

    const handlers = Reflect.getMetadata(
      MATADOR_EVENT_HANDLERS,
      ServiceWithAllOptions,
    );

    expect(handlers[0].options.idempotent).toBe('yes');
    expect(handlers[0].options.importance).toBe('must-investigate');
    expect(handlers[0].options.targetQueue).toBe('priority-queue');
  });

  it('supports resumable subscribers', () => {
    class ResumableService {
      @OnMatadorEvent(TestEvent, {
        description: 'Resumable handler',
        idempotent: 'resumable',
      })
      async handleEvent(_envelope: Envelope<TestEvent['data']>) {
        // handler
      }
    }

    const handlers = Reflect.getMetadata(
      MATADOR_EVENT_HANDLERS,
      ResumableService,
    );

    expect(handlers[0].options.idempotent).toBe('resumable');
  });
});

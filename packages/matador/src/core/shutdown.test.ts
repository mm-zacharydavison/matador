import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Logger } from '../hooks/index.js';
import { ShutdownManager, type ShutdownState } from './shutdown.js';

describe('ShutdownManager', () => {
  let getEnqueueCount: () => number;
  let stopReceiving: () => Promise<void>;
  let disconnectTransport: () => Promise<void>;
  let manager: ShutdownManager;
  let enqueuedCount: number;

  beforeEach(() => {
    enqueuedCount = 0;
    getEnqueueCount = mock(() => enqueuedCount);
    stopReceiving = mock(async () => {});
    disconnectTransport = mock(async () => {});
  });

  describe('static factory', () => {
    it('should create instance via static create method', () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      expect(manager).toBeInstanceOf(ShutdownManager);
      expect(manager.state).toBe('running');
    });

    it('should accept partial config overrides', () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        { gracefulShutdownTimeout: 5000 },
      );

      expect(manager).toBeInstanceOf(ShutdownManager);
    });
  });

  describe('initial state', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should start in running state', () => {
      expect(manager.state).toBe('running');
    });

    it('should allow enqueue initially', () => {
      expect(manager.isEnqueueAllowed).toBe(true);
    });

    it('should report idle when no events processing', () => {
      const state = manager.getHandlersState();
      expect(state.isIdle).toBe(true);
      expect(state.eventsBeingProcessed).toBe(0);
      expect(state.eventsBeingEnqueued).toBe(0);
    });
  });

  describe('getHandlersState', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should return correct handler state with no activity', () => {
      const state = manager.getHandlersState();

      expect(state.eventsBeingProcessed).toBe(0);
      expect(state.eventsBeingEnqueued).toBe(0);
      expect(state.isIdle).toBe(true);
    });

    it('should track events being processed', () => {
      manager.incrementProcessing();
      manager.incrementProcessing();

      const state = manager.getHandlersState();

      expect(state.eventsBeingProcessed).toBe(2);
      expect(state.isIdle).toBe(false);
    });

    it('should track events being enqueued via callback', () => {
      enqueuedCount = 3;

      const state = manager.getHandlersState();

      expect(state.eventsBeingEnqueued).toBe(3);
      expect(state.isIdle).toBe(false);
    });

    it('should report not idle when processing exists', () => {
      manager.incrementProcessing();
      enqueuedCount = 0;

      const state = manager.getHandlersState();

      expect(state.isIdle).toBe(false);
    });

    it('should report not idle when enqueuing exists', () => {
      enqueuedCount = 2;

      const state = manager.getHandlersState();

      expect(state.isIdle).toBe(false);
    });

    it('should report idle only when both counters are zero', () => {
      manager.incrementProcessing();
      manager.incrementProcessing();
      enqueuedCount = 1;

      let state = manager.getHandlersState();
      expect(state.isIdle).toBe(false);

      manager.decrementProcessing();
      state = manager.getHandlersState();
      expect(state.isIdle).toBe(false);

      manager.decrementProcessing();
      state = manager.getHandlersState();
      expect(state.isIdle).toBe(false);

      enqueuedCount = 0;
      state = manager.getHandlersState();
      expect(state.isIdle).toBe(true);
    });
  });

  describe('processing counter', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should increment processing counter', () => {
      manager.incrementProcessing();
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(1);

      manager.incrementProcessing();
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(2);
    });

    it('should decrement processing counter', () => {
      manager.incrementProcessing();
      manager.incrementProcessing();
      manager.incrementProcessing();

      manager.decrementProcessing();
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(2);

      manager.decrementProcessing();
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(1);
    });
  });

  describe('graceful shutdown', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should transition through all shutdown states', async () => {
      const states: ShutdownState[] = [];

      const checkState = async () => {
        states.push(manager.state);
      };

      stopReceiving = mock(async () => {
        await checkState();
      });

      disconnectTransport = mock(async () => {
        await checkState();
      });

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      const initialState = manager.state;
      await manager.shutdown();
      const finalState = manager.state;

      expect(initialState).toBe('running');
      expect(states[0]).toBe('stopping-receive');
      expect(states[1]).toBe('disconnecting');
      expect(finalState).toBe('stopped');
    });

    it('should call stopReceiving during shutdown', async () => {
      await manager.shutdown();

      expect(stopReceiving).toHaveBeenCalledTimes(1);
    });

    it('should call disconnectTransport during shutdown', async () => {
      await manager.shutdown();

      expect(disconnectTransport).toHaveBeenCalledTimes(1);
    });

    it('should disable enqueue during shutdown', async () => {
      expect(manager.isEnqueueAllowed).toBe(true);

      await manager.shutdown();

      expect(manager.isEnqueueAllowed).toBe(false);
    });

    it('should wait for in-flight messages to complete', async () => {
      manager.incrementProcessing();
      manager.incrementProcessing();

      const shutdownPromise = manager.shutdown();

      expect(manager.state).toBe('stopping-receive');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');

      manager.decrementProcessing();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');

      manager.decrementProcessing();

      await shutdownPromise;

      expect(manager.state).toBe('stopped');
    });

    it('should wait for enqueued messages to complete', async () => {
      enqueuedCount = 2;

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');

      enqueuedCount = 0;

      await shutdownPromise;

      expect(manager.state).toBe('stopped');
    });

    it('should wait for both processing and enqueued to complete', async () => {
      manager.incrementProcessing();
      enqueuedCount = 1;

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');

      manager.decrementProcessing();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');

      enqueuedCount = 0;

      await shutdownPromise;

      expect(manager.state).toBe('stopped');
    });
  });

  describe('shutdown timeout', () => {
    it('should force shutdown after timeout', async () => {
      const logs: string[] = [];
      const mockLogger: Logger = {
        debug: (msg: string) => logs.push(`debug: ${msg}`),
        info: (msg: string) => logs.push(`info: ${msg}`),
        warn: (msg: string) => logs.push(`warn: ${msg}`),
        error: (msg: string) => logs.push(`error: ${msg}`),
      };

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 100,
          idlePollingInterval: 20,
          logger: mockLogger,
        },
      );

      manager.incrementProcessing();
      manager.incrementProcessing();

      await manager.shutdown();

      expect(manager.state).toBe('stopped');
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(2);
      expect(logs.some((log) => log.includes('Shutdown timeout reached'))).toBe(
        true,
      );
      expect(
        logs.some((log) => log.includes('2 events still processing')),
      ).toBe(true);
    });

    it('should use custom timeout configuration', async () => {
      const logs: string[] = [];
      const mockLogger: Logger = {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => logs.push(msg),
        error: () => {},
      };

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 50,
          idlePollingInterval: 10,
          logger: mockLogger,
        },
      );

      manager.incrementProcessing();

      const startTime = Date.now();
      await manager.shutdown();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(200);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should poll at configured interval', async () => {
      let pollCount = 0;
      const countingGetEnqueueCount = mock(() => {
        pollCount++;
        return 1;
      });

      manager = new ShutdownManager(
        countingGetEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 100,
          idlePollingInterval: 20,
        },
      );

      await manager.shutdown();

      expect(pollCount).toBeGreaterThan(3);
    });
  });

  describe('idempotent shutdown', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should be idempotent when called multiple times', async () => {
      await manager.shutdown();
      expect(manager.state).toBe('stopped');

      await manager.shutdown();
      expect(manager.state).toBe('stopped');

      await manager.shutdown();
      expect(manager.state).toBe('stopped');

      expect(stopReceiving).toHaveBeenCalledTimes(1);
      expect(disconnectTransport).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent shutdown calls', async () => {
      const results = await Promise.all([
        manager.shutdown(),
        manager.shutdown(),
        manager.shutdown(),
      ]);

      expect(manager.state).toBe('stopped');
      expect(results).toHaveLength(3);
      expect(stopReceiving).toHaveBeenCalledTimes(1);
      expect(disconnectTransport).toHaveBeenCalledTimes(1);
    });

    it('should not restart shutdown sequence if already shutting down', async () => {
      manager.incrementProcessing();

      const shutdown1 = manager.shutdown();

      expect(manager.state).toBe('stopping-receive');

      const shutdown2 = manager.shutdown();

      manager.decrementProcessing();

      await Promise.all([shutdown1, shutdown2]);

      expect(manager.state).toBe('stopped');
      expect(stopReceiving).toHaveBeenCalledTimes(1);
    });
  });

  describe('forceStop', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should stop immediately without waiting', async () => {
      manager.incrementProcessing();
      manager.incrementProcessing();
      enqueuedCount = 5;

      await manager.forceStop();

      expect(manager.state).toBe('stopped');
      expect(manager.isEnqueueAllowed).toBe(false);
      expect(manager.getHandlersState().eventsBeingProcessed).toBe(2);
      expect(manager.getHandlersState().eventsBeingEnqueued).toBe(5);
    });

    it('should call stopReceiving', async () => {
      await manager.forceStop();

      expect(stopReceiving).toHaveBeenCalledTimes(1);
    });

    it('should call disconnectTransport', async () => {
      await manager.forceStop();

      expect(disconnectTransport).toHaveBeenCalledTimes(1);
    });

    it('should complete much faster than graceful shutdown', async () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 1000,
        },
      );

      manager.incrementProcessing();

      const startTime = Date.now();
      await manager.forceStop();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
    });

    it('should disable enqueue', async () => {
      expect(manager.isEnqueueAllowed).toBe(true);

      await manager.forceStop();

      expect(manager.isEnqueueAllowed).toBe(false);
    });
  });

  describe('state transitions', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should follow correct sequence: running -> stopping-receive -> waiting-handlers -> stopping-enqueue -> disconnecting -> stopped', async () => {
      const states: ShutdownState[] = [];

      states.push(manager.state);

      const originalStopReceiving = stopReceiving;
      const originalDisconnect = disconnectTransport;

      stopReceiving = mock(async () => {
        await originalStopReceiving();
        states.push(manager.state);
      });

      disconnectTransport = mock(async () => {
        await originalDisconnect();
        states.push(manager.state);
      });

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      manager.incrementProcessing();

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));
      states.push(manager.state);

      manager.decrementProcessing();

      await shutdownPromise;
      states.push(manager.state);

      expect(states[0]).toBe('running');
      expect(states[1]).toBe('stopping-receive');
      expect(states[2]).toBe('waiting-handlers');
      expect(states[3]).toBe('disconnecting');
      expect(states[4]).toBe('stopped');
    });

    it('should remain in waiting-handlers while events are processing', async () => {
      manager.incrementProcessing();

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(manager.state).toBe('waiting-handlers');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(manager.state).toBe('waiting-handlers');

      manager.decrementProcessing();

      await shutdownPromise;
      expect(manager.state).toBe('stopped');
    });
  });

  describe('event handler deregistration during shutdown', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should block new enqueue operations after stopping-enqueue state', async () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          idlePollingInterval: 20,
        },
      );

      manager.incrementProcessing();

      expect(manager.isEnqueueAllowed).toBe(true);

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.state).toBe('waiting-handlers');
      expect(manager.isEnqueueAllowed).toBe(true);

      manager.decrementProcessing();

      await shutdownPromise;

      expect(manager.state).toBe('stopped');
      expect(manager.isEnqueueAllowed).toBe(false);
    });

    it('should allow completion of in-flight events during shutdown', async () => {
      manager.incrementProcessing();
      manager.incrementProcessing();
      const initialCount = manager.getHandlersState().eventsBeingProcessed;

      const shutdownPromise = manager.shutdown();

      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.decrementProcessing();

      expect(manager.getHandlersState().eventsBeingProcessed).toBe(
        initialCount - 1,
      );

      manager.decrementProcessing();

      await shutdownPromise;

      expect(manager.getHandlersState().eventsBeingProcessed).toBe(0);
      expect(manager.state).toBe('stopped');
    });
  });

  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      expect(manager).toBeInstanceOf(ShutdownManager);
    });

    it('should accept custom gracefulShutdownTimeout', async () => {
      const logs: string[] = [];
      const mockLogger: Logger = {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => logs.push(msg),
        error: () => {},
      };

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 10,
          idlePollingInterval: 5,
          logger: mockLogger,
        },
      );

      manager.incrementProcessing();

      const startTime = Date.now();
      await manager.shutdown();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(100);
    });

    it('should accept custom logger', async () => {
      const logs: string[] = [];
      const mockLogger: Logger = {
        debug: (msg: string) => logs.push(msg),
        info: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(msg),
      };

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 50,
          logger: mockLogger,
        },
      );

      manager.incrementProcessing();

      await manager.shutdown();

      expect(logs.some((log) => log.includes('Shutdown timeout reached'))).toBe(
        true,
      );
    });

    it('should accept custom idlePollingInterval', async () => {
      let pollCount = 0;
      const countingGetEnqueueCount = mock(() => {
        pollCount++;
        if (pollCount > 2) {
          return 0;
        }
        return 1;
      });

      manager = new ShutdownManager(
        countingGetEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          idlePollingInterval: 10,
          gracefulShutdownTimeout: 1000,
        },
      );

      const startTime = Date.now();
      await manager.shutdown();
      const duration = Date.now() - startTime;

      expect(pollCount).toBeGreaterThanOrEqual(2);
      expect(duration).toBeGreaterThanOrEqual(20);
      expect(duration).toBeLessThan(200);
    });
  });

  describe('error handling', () => {
    it('should handle errors in stopReceiving', async () => {
      const error = new Error('Stop receiving failed');
      stopReceiving = mock(async () => {
        throw error;
      });

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      await expect(manager.shutdown()).rejects.toThrow('Stop receiving failed');
    });

    it('should handle errors in disconnectTransport', async () => {
      const error = new Error('Disconnect failed');
      disconnectTransport = mock(async () => {
        throw error;
      });

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      await expect(manager.shutdown()).rejects.toThrow('Disconnect failed');
    });

    it('should handle errors in getEnqueueCount callback', async () => {
      getEnqueueCount = mock(() => {
        throw new Error('Count failed');
      });

      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );

      expect(() => manager.getHandlersState()).toThrow('Count failed');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
      );
    });

    it('should handle shutdown with no active events', async () => {
      await manager.shutdown();

      expect(manager.state).toBe('stopped');
      expect(manager.getHandlersState().isIdle).toBe(true);
    });

    it('should handle rapid increment/decrement cycles', () => {
      for (let i = 0; i < 100; i++) {
        manager.incrementProcessing();
      }

      expect(manager.getHandlersState().eventsBeingProcessed).toBe(100);

      for (let i = 0; i < 100; i++) {
        manager.decrementProcessing();
      }

      expect(manager.getHandlersState().eventsBeingProcessed).toBe(0);
      expect(manager.getHandlersState().isIdle).toBe(true);
    });

    it('should handle events completing exactly at timeout', async () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 100,
          idlePollingInterval: 50,
        },
      );

      manager.incrementProcessing();

      const shutdownPromise = manager.shutdown();

      setTimeout(() => {
        manager.decrementProcessing();
      }, 90);

      await shutdownPromise;

      expect(manager.state).toBe('stopped');
    });

    it('should handle zero timeout gracefully', async () => {
      manager = new ShutdownManager(
        getEnqueueCount,
        stopReceiving,
        disconnectTransport,
        {
          gracefulShutdownTimeout: 0,
        },
      );

      manager.incrementProcessing();

      await manager.shutdown();

      expect(manager.state).toBe('stopped');
    });
  });
});

#!/usr/bin/env bun
/**
 * Matador CLI - Quick local testing of your Matador config
 *
 * Usage:
 *   bunx matador send <config-file> <event-file> [options]
 *   bunx matador send-test-event <config-file>
 *
 * Commands:
 *   send             Send an event using a config and event file
 *   send-test-event  Send a test event using the examples in config
 *
 * Config file should export:
 *   - schema: MatadorSchema - Map of event keys to [EventClass, Subscribers[]]
 *   - topology?: Topology - Optional topology (defaults to simple 'events' queue)
 *   - hooks?: MatadorHooks - Optional hooks
 *   - testEvent?: { eventKey, data, before?, options? } - Test event for send-test-event command
 *
 * Event file should export:
 *   - eventKey: string - The key of the event to dispatch
 *   - data: unknown - The event data payload
 *   - before?: unknown - Optional 'before' data for change events
 *   - options?: EventOptions - Optional dispatch options (correlationId, metadata, delayMs)
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type EventOptions,
  LocalTransport,
  Matador,
  type MatadorHooks,
  type MatadorSchema,
  type Topology,
  TopologyBuilder,
  consoleLogger,
  isSchemaEntryTuple,
} from './src/index.js';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string): void {
  console.log();
  log(`━━━ ${title} ━━━`, 'cyan');
}

function logSuccess(message: string): void {
  log(`✓ ${message}`, 'green');
}

function logError(message: string): void {
  log(`✗ ${message}`, 'red');
}

function logInfo(message: string): void {
  log(`ℹ ${message}`, 'blue');
}

function logWarning(message: string): void {
  log(`⚠ ${message}`, 'yellow');
}

interface TestEventSpec {
  eventKey: string;
  data: unknown;
  before?: unknown;
  options?: EventOptions;
}

interface ConfigExport {
  schema: MatadorSchema;
  topology?: Topology;
  hooks?: MatadorHooks;
  testEvent?: TestEventSpec;
}

interface EventExport {
  eventKey: string;
  data: unknown;
  before?: unknown;
  options?: EventOptions;
}

function printUsage(): void {
  console.log(`
${colors.bold}Matador CLI${colors.reset} - Quick local testing of your Matador config

${colors.cyan}Usage:${colors.reset}
  bunx matador send <config-file> <event-file> [options]
  bunx matador send-test-event <config-file>

${colors.cyan}Commands:${colors.reset}
  send             Send an event using a config and event file
  send-test-event  Send a test event defined in the config file

${colors.cyan}Options:${colors.reset}
  --help, -h    Show this help message
  --dry-run     Validate config and event without dispatching
  --timeout     Timeout in milliseconds for processing (default: 5000)
  --verbose     Show verbose output including all hook logs

${colors.cyan}Config file exports:${colors.reset}
  schema        MatadorSchema - Map of event keys to [EventClass, Subscribers[]]
  topology?     Topology - Optional topology config
  hooks?        MatadorHooks - Optional hooks for logging
  testEvent?    { eventKey, data, before?, options? } - Test event for send-test-event

${colors.cyan}Event file exports:${colors.reset}
  eventKey      string - The key of the event to dispatch
  data          unknown - The event data payload
  before?       unknown - Optional 'before' data for change events
  options?      EventOptions - Optional dispatch options

${colors.cyan}Examples:${colors.reset}
  bunx matador send ./my-config.ts ./test-event.ts
  bunx matador send ./config.ts ./event.json --verbose --timeout 10000
  bunx matador send-test-event ./my-config.ts
`);
}

async function loadModule<T>(filePath: string): Promise<T> {
  const absolutePath = resolve(process.cwd(), filePath);

  if (filePath.endsWith('.json')) {
    const file = Bun.file(absolutePath);
    return (await file.json()) as T;
  }

  const module = await import(absolutePath);
  return module.default ?? module;
}

async function runSend(
  configPath: string,
  eventPath: string,
  options: { dryRun: boolean; timeout: number; verbose: boolean },
): Promise<void> {
  logSection('Loading Configuration');

  // Load config file
  let config: ConfigExport;
  try {
    logInfo(`Loading config from: ${configPath}`);
    config = await loadModule<ConfigExport>(configPath);

    if (!config.schema || typeof config.schema !== 'object') {
      throw new Error('Config must export a "schema" object');
    }

    const eventCount = Object.keys(config.schema).length;
    const subscriberCount = Object.values(config.schema).reduce(
      (acc, entry) => {
        if (isSchemaEntryTuple(entry)) {
          return acc + entry[1].length;
        }
        return acc + entry.subscribers.length;
      },
      0,
    );
    logSuccess(
      `Loaded ${eventCount} event(s) and ${subscriberCount} subscriber(s)`,
    );
  } catch (err) {
    logError(
      `Failed to load config: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }

  // Load event file
  let eventSpec: EventExport;
  try {
    logInfo(`Loading event from: ${eventPath}`);
    eventSpec = await loadModule<EventExport>(eventPath);

    if (!eventSpec.eventKey || typeof eventSpec.eventKey !== 'string') {
      throw new Error('Event file must export an "eventKey" string');
    }
    if (eventSpec.data === undefined) {
      throw new Error('Event file must export a "data" property');
    }

    logSuccess(`Event key: ${eventSpec.eventKey}`);
  } catch (err) {
    logError(
      `Failed to load event: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }

  await dispatchEvent(config, eventSpec, options);
}

async function runSendTestEvent(
  configPath: string,
  options: { dryRun: boolean; timeout: number; verbose: boolean },
): Promise<void> {
  logSection('Loading Configuration');

  // Load config file
  let config: ConfigExport;
  try {
    logInfo(`Loading config from: ${configPath}`);
    config = await loadModule<ConfigExport>(configPath);

    if (!config.schema || typeof config.schema !== 'object') {
      throw new Error('Config must export a "schema" object');
    }

    if (!config.testEvent) {
      throw new Error(
        'Config must export a "testEvent" object for send-test-event command',
      );
    }

    const eventCount = Object.keys(config.schema).length;
    const subscriberCount = Object.values(config.schema).reduce(
      (acc, entry) => {
        if (isSchemaEntryTuple(entry)) {
          return acc + entry[1].length;
        }
        return acc + entry.subscribers.length;
      },
      0,
    );
    logSuccess(
      `Loaded ${eventCount} event(s) and ${subscriberCount} subscriber(s)`,
    );
    logSuccess(`Test event key: ${config.testEvent.eventKey}`);
  } catch (err) {
    logError(
      `Failed to load config: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }

  await dispatchEvent(config, config.testEvent, options);
}

async function dispatchEvent(
  config: ConfigExport,
  eventSpec: EventExport,
  options: { dryRun: boolean; timeout: number; verbose: boolean },
): Promise<void> {
  // Validate event exists in config
  const schemaEntry = config.schema[eventSpec.eventKey];
  if (!schemaEntry) {
    logError(`Event "${eventSpec.eventKey}" not found in config`);
    logInfo(`Available events: ${Object.keys(config.schema).join(', ')}`);
    process.exit(1);
  }

  // Extract EventClass and subscribers from schema entry
  const EventClass = isSchemaEntryTuple(schemaEntry)
    ? schemaEntry[0]
    : schemaEntry.eventClass;
  const subscribers = isSchemaEntryTuple(schemaEntry)
    ? schemaEntry[1]
    : schemaEntry.subscribers;

  if (!subscribers || subscribers.length === 0) {
    logWarning(`No subscribers registered for event "${eventSpec.eventKey}"`);
  } else {
    logInfo(`Subscribers: ${subscribers.map((s) => s.name).join(', ')}`);
  }

  if (options.dryRun) {
    logSection('Dry Run Complete');
    logSuccess('Config and event validated successfully');
    logInfo('Use without --dry-run to actually dispatch the event');
    process.exit(0);
  }

  logSection('Dispatching Event');

  // Create topology
  const topology =
    config.topology ??
    TopologyBuilder.create()
      .withNamespace('cli-test')
      .addQueue('events')
      .withoutDeadLetter()
      .build();

  // Create transport
  const transport = new LocalTransport();

  // Create hooks for logging
  const hooks: MatadorHooks = {
    logger: options.verbose ? consoleLogger : undefined,
    onWorkerSuccess: (ctx) => {
      logSuccess(`[${ctx.subscriber.name}] processed in ${ctx.durationMs}ms`);
    },
    onWorkerError: (ctx) => {
      logError(
        `[${ctx.subscriber.name}] failed after ${ctx.durationMs}ms: ${ctx.error.message}`,
      );
    },
    ...config.hooks,
  };

  // Create Matador instance with schema and hooks
  const matador = new Matador(
    {
      transport,
      topology,
      schema: config.schema,
      consumeFrom: topology.queues.map((q) => q.name),
    },
    hooks,
  );

  try {
    await matador.start();
    logSuccess('Matador started');

    // Create and dispatch the event
    const event = new EventClass(eventSpec.data, eventSpec.before);
    logInfo(`Dispatching: ${eventSpec.eventKey}`);

    if (options.verbose) {
      logInfo(`Data: ${JSON.stringify(eventSpec.data, null, 2)}`);
      if (eventSpec.before) {
        logInfo(`Before: ${JSON.stringify(eventSpec.before, null, 2)}`);
      }
      if (eventSpec.options) {
        logInfo(`Options: ${JSON.stringify(eventSpec.options, null, 2)}`);
      }
    }

    const result = await matador.send(event, eventSpec.options);

    logSection('Send Result');
    logInfo(`Event key: ${result.eventKey}`);
    logInfo(`Subscribers sent: ${result.subscribersSent}`);
    logInfo(`Subscribers skipped: ${result.subscribersSkipped}`);

    if (result.errors.length > 0) {
      logWarning(`Dispatch errors: ${result.errors.length}`);
      for (const err of result.errors) {
        logError(`  [${err.subscriberName}] ${err.error.message}`);
      }
    }

    // Wait for processing
    logSection('Processing');
    const idle = await matador.waitForIdle(options.timeout);

    if (idle) {
      logSuccess('All subscribers finished processing');
    } else {
      logWarning(`Timed out after ${options.timeout}ms waiting for processing`);
    }

    await matador.shutdown();
    logSuccess('Matador shutdown complete');

    logSection('Summary');
    if (result.errors.length === 0 && idle) {
      logSuccess('Event dispatched and processed successfully!');
      process.exit(0);
    } else {
      logWarning('Event dispatched with issues');
      process.exit(1);
    }
  } catch (err) {
    logError(`Error: ${err instanceof Error ? err.message : err}`);
    await matador.shutdown().catch(() => {});
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  // Check for help flag first
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'send') {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        'dry-run': { type: 'boolean' },
        timeout: { type: 'string', default: '5000' },
        verbose: { type: 'boolean' },
      },
      allowPositionals: true,
    });

    if (positionals.length < 2) {
      logError('Missing required arguments: <config-file> <event-file>');
      logInfo('Usage: bunx matador send <config-file> <event-file> [options]');
      process.exit(1);
    }

    const [configPath, eventPath] = positionals;
    await runSend(configPath!, eventPath!, {
      dryRun: values['dry-run'] ?? false,
      timeout: Number.parseInt(values.timeout ?? '5000', 10),
      verbose: values.verbose ?? false,
    });
  } else if (command === 'send-test-event') {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        'dry-run': { type: 'boolean' },
        timeout: { type: 'string', default: '5000' },
        verbose: { type: 'boolean' },
      },
      allowPositionals: true,
    });

    if (positionals.length < 1) {
      logError('Missing required argument: <config-file>');
      logInfo('Usage: bunx matador send-test-event <config-file> [options]');
      process.exit(1);
    }

    const [configPath] = positionals;
    await runSendTestEvent(configPath!, {
      dryRun: values['dry-run'] ?? false,
      timeout: Number.parseInt(values.timeout ?? '5000', 10),
      verbose: values.verbose ?? false,
    });
  } else {
    logError(`Unknown command: ${command}`);
    logInfo('Available commands: send, send-test-event');
    logInfo('Run "bunx matador --help" for usage information');
    process.exit(1);
  }
}

main();

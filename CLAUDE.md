# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Matador is an opinionated, transport-agnostic event processing library for TypeScript. It provides fanout-style event dispatch (one event → multiple subscriber messages) with RabbitMQ as the primary supported broker. Designed for monorepos where Event and Subscriber types are shared between dispatcher and consumer packages.

## Commands

```bash
# Development
bun install              # Install dependencies
bun run build            # Build all packages
bun run typecheck        # Type check all packages
bun run lint             # Lint with Biome
bun run lint:fix         # Lint and auto-fix

# Testing
bun test                 # Run all tests
bun test --watch         # Watch mode
bun test --grep "pattern"  # Filter tests by name

# Package-specific (from packages/matador)
bun run test:integration # Integration tests (requires Docker for RabbitMQ)
bun run cli <config> <event>  # CLI for local testing
bun run send-test-event  # Send test event using examples
```

## Architecture

```
packages/matador/src/
├── core/           # Matador orchestrator, fanout engine, shutdown manager
├── transport/      # Transport interface + implementations (local, rabbitmq, fallback)
├── topology/       # Queue topology builder and configuration
├── schema/         # Event-to-subscriber registry
├── pipeline/       # Message processing pipeline
├── codec/          # Message serialization (JSON)
├── retry/          # Retry policies
├── hooks/          # Lifecycle hooks for observability
├── types/          # Event, Subscriber, Envelope types
└── errors/         # Typed errors with descriptions
```

### Core Concepts

- **Matador**: Main orchestrator that wires transport, schema, pipeline, fanout, and shutdown
- **Transport**: Interface for brokers (`LocalTransport` for testing, `RabbitMQTransport` for production, `FallbackTransport` for redundancy)
- **Schema**: Maps `EventKey` → `[EventClass, Subscriber[]]`
- **Fanout**: Creates unique envelope per subscriber when dispatching an event
- **Envelope**: Wraps event data with routing info (`Docket`) and attempt tracking
- **Pipeline**: Processes incoming messages: decode → validate → retry check → execute callback → ack/nack

### Event Flow

1. `dispatch(event)` → FanoutEngine creates envelopes per subscriber
2. Transport sends to appropriate queue based on `subscriber.targetQueue`
3. Consumer receives message → Pipeline processes → Subscriber callback executes
4. Retry/dead-letter based on idempotency and retry policy

## Code Style

- Biome for linting and formatting (2-space indent, single quotes, semicolons)
- `noExplicitAny: error` - avoid `any` type
- All errors extend `MatadorError` with a `description` field explaining cause and resolution
- ESM modules with `.js` extensions in imports

export type {
  AnyEventClass,
  MatadorSchema,
  RegisterOptions,
  RuntimeSchemaEntry,
  RuntimeSchemaEntryTuple,
  SchemaEntry,
  SchemaEntryTuple,
  SchemaIssue,
  SchemaPlugin,
  SchemaValidationResult,
} from './types.js';

export { bind, installPlugins, isSchemaEntryTuple } from './types.js';

export { SchemaError, SchemaRegistry } from './registry.js';

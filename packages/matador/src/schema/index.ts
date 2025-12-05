export type {
  MatadorSchema,
  RegisterOptions,
  SchemaEntry,
  SchemaEntryTuple,
  SchemaIssue,
  SchemaValidationResult,
} from './types.js';

export { isSchemaEntryTuple } from './types.js';

export {
  createSchemaRegistry,
  SchemaError,
  SchemaRegistry,
} from './registry.js';

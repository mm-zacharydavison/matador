/**
 * Interface for errors that provide a human-readable description.
 * The description explains what the error means and what actions
 * users should take when encountering it in logs/observability.
 */
export interface HasDescription {
  /**
   * Human-readable description of the error type.
   * Intended for logging and observability to help users understand
   * the error and determine appropriate remediation steps.
   */
  readonly description: string;
}

/**
 * Type guard to check if an error implements HasDescription.
 */
export function hasDescription(error: unknown): error is HasDescription {
  return (
    typeof error === 'object' &&
    error !== null &&
    'description' in error &&
    typeof (error as HasDescription).description === 'string'
  );
}

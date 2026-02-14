/**
 * Logger interface for dependency injection
 * Keeps domain layer pure by depending on abstraction, not concrete implementation
 */

export type LogContext = Record<string, unknown>

export interface Logger {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
}

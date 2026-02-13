type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

type Logger = {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const getMinLogLevel = (): number => {
  const env = process.env.NODE_ENV || 'development'

  // Production: only WARN and ERROR
  if (env === 'production') {
    return LOG_LEVELS.warn
  }

  // Development: everything (DEBUG+)
  return LOG_LEVELS.debug
}

const minLevel = getMinLogLevel()

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] >= minLevel
}

const formatLog = (level: LogLevel, message: string, context?: LogContext) => {
  const timestamp = new Date().toISOString()

  // Structured JSON for production
  if (process.env.NODE_ENV === 'production') {
    return {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...context,
    }
  }

  // Human-readable for development
  return {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...(context && Object.keys(context).length > 0 ? context : {}),
  }
}

const log = (level: LogLevel, method: typeof console.log) => {
  return (message: string, context?: LogContext) => {
    if (!shouldLog(level)) return

    const formattedLog = formatLog(level, message, context)
    method(formattedLog)
  }
}

export const logger: Logger = {
  debug: log('debug', console.debug),
  info: log('info', console.info),
  warn: log('warn', console.warn),
  error: log('error', console.error),
}

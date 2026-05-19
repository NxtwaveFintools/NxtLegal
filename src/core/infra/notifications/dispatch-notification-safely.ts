import { logger } from '@/core/infra/logging/logger'

type DispatchNotificationSafelyParams = {
  dispatch: () => Promise<unknown>
  event: string
  contractId: string
}

export function dispatchNotificationSafely({ dispatch, event, contractId }: DispatchNotificationSafelyParams): void {
  void Promise.resolve()
    .then(dispatch)
    .catch((error) => {
      logger.warn('Contract action notification dispatch failed', {
        event,
        contractId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

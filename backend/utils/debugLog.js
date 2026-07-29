/**
 * Hot-path verbose logs (calls, FCM, presence, chess/card moves). Quiet in
 * production so high concurrency doesn't flood stdout. Errors/warns stay.
 *
 * Enable:  CALL_DEBUG=1  or  DEBUG_LOGS=1
 * Disable: CALL_DEBUG=0
 * Default: on when NODE_ENV !== 'production'
 */
export const isDebugLogs = () => {
    if (process.env.CALL_DEBUG === '1' || process.env.DEBUG_LOGS === '1') return true
    if (process.env.CALL_DEBUG === '0') return false
    return process.env.NODE_ENV !== 'production'
}

export const debugLog = (...args) => {
    if (isDebugLogs()) console.log(...args)
}

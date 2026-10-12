const MAX_PLAIN_TEXT_LENGTH = 200

/**
 * Extracts a user-presentable message from a thrown API error.
 * Handles plain strings, `{ message }` objects (409) and FluentValidation
 * arrays (400). Anything else yields the fallback.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    const text = error.trim()
    if (text && !text.startsWith('<') && text.length <= MAX_PLAIN_TEXT_LENGTH) return text
    return fallback
  }
  if (Array.isArray(error)) {
    const first: unknown = error[0]
    if (first && typeof first === 'object') {
      const msg = (first as { errorMessage?: unknown }).errorMessage
      if (typeof msg === 'string' && msg.trim()) return msg
    }
    return fallback
  }
  if (error && typeof error === 'object') {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return fallback
}

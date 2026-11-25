export const AREA_NAME_MAX = 100

/** Validates the trimmed name (the server trims it). Returns the message, or null when valid. */
export function validateAreaName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name is required.'
  if (trimmed.length > AREA_NAME_MAX) return `Name must be ${AREA_NAME_MAX} characters or fewer.`
  return null
}

import { describe, it, expect } from 'vitest'
import { validateAreaName } from './area-validation'

describe('validateAreaName', () => {
  it.each([
    ['', 'Name is required.'],
    ['   ', 'Name is required.'],
    ['a'.repeat(101), 'Name must be 100 characters or fewer.'],
    ['a'.repeat(100), null],
    // Measured after trimming, as the server stores it.
    [`  ${'a'.repeat(100)}  `, null],
  ])('%j gives %j', (name, message) => {
    expect(validateAreaName(name)).toBe(message)
  })
})

import { describe, it, expect } from 'vitest'
import { getApiErrorMessage } from './api-error'

describe('getApiErrorMessage', () => {
  it('returns message from an object', () => {
    expect(getApiErrorMessage({ message: 'Name taken' }, 'fb')).toBe('Name taken')
  })
  it('returns short plain strings', () => {
    expect(getApiErrorMessage('Oops', 'fb')).toBe('Oops')
  })
  it('rejects HTML strings', () => {
    expect(getApiErrorMessage('<html>bad</html>', 'fb')).toBe('fb')
  })
  it('rejects very long strings', () => {
    expect(getApiErrorMessage('x'.repeat(201), 'fb')).toBe('fb')
  })
  it.each([[''], [undefined], [null], [42]])('falls back for %s', (v) => {
    expect(getApiErrorMessage(v, 'fb')).toBe('fb')
  })
  it('reads the first FluentValidation error', () => {
    expect(
      getApiErrorMessage([{ propertyName: 'name', errorMessage: 'Name is required' }], 'fb'),
    ).toBe('Name is required')
  })
  it('falls back for empty or malformed arrays', () => {
    expect(getApiErrorMessage([], 'fb')).toBe('fb')
    expect(getApiErrorMessage([{ foo: 1 }], 'fb')).toBe('fb')
    expect(getApiErrorMessage([1], 'fb')).toBe('fb')
  })
  it('falls back for object without message', () => {
    expect(getApiErrorMessage({ status: 404 }, 'fb')).toBe('fb')
  })
  it('falls back for empty-string message', () => {
    expect(getApiErrorMessage({ message: '' }, 'fb')).toBe('fb')
  })
})

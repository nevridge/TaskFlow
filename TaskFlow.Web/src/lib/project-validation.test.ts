import { describe, it, expect } from 'vitest'
import { validateProject } from './project-validation'

describe('validateProject', () => {
  it('accepts name lengths 1 and 100', () => {
    expect(validateProject({ name: 'a', description: '' })).toEqual({})
    expect(validateProject({ name: 'a'.repeat(100), description: '' })).toEqual({})
  })
  it('rejects empty and whitespace-only names', () => {
    expect(validateProject({ name: '', description: '' }).name).toBeDefined()
    expect(validateProject({ name: '   ', description: '' }).name).toBeDefined()
  })
  it('rejects 101-char names but measures the trimmed value', () => {
    expect(validateProject({ name: 'a'.repeat(101), description: '' }).name).toBeDefined()
    expect(validateProject({ name: ` ${'a'.repeat(100)} `, description: '' })).toEqual({})
  })
  it('enforces description max 2000', () => {
    expect(validateProject({ name: 'a', description: 'd'.repeat(2000) })).toEqual({})
    expect(validateProject({ name: 'a', description: 'd'.repeat(2001) }).description).toBeDefined()
  })
})

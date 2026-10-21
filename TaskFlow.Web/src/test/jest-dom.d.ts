import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// vitest 5 types Assertion<R, T> and exposes `Matchers<R, T>` as the extension point.
// @testing-library/jest-dom's own vitest augmentation still targets the old Assertion<T> shape.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void>, T>
    extends TestingLibraryMatchers<unknown, R> {}
}

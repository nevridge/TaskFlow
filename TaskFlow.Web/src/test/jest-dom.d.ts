import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// vitest 5 types Assertion<R, T> and exposes `Matchers<R, T>` as the extension point.
// @testing-library/jest-dom's own vitest augmentation still targets the old Assertion<T> shape.
// Remove this shim once @testing-library/jest-dom ships typings for vitest 5's Matchers<R, T>.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void>, T>
    extends TestingLibraryMatchers<unknown, R> {}
}

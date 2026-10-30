import { client } from '@/api/client/client.gen'

/**
 * Makes every generated-client and hand-written API call reject on HTTP errors (4xx/5xx).
 * `throwOnError` is a RUNTIME flag; the `true` generic on client.get/post/... is type-only and
 * does not change behaviour. Call once at app startup (main.tsx). A call that needs the
 * `{ error, response }` result instead (e.g. undo-delete commits) passes `throwOnError: false`.
 */
export function configureApiClient(): void {
  client.setConfig({ throwOnError: true })
}

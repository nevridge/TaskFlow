import { client } from './client/client.gen'

export type AreaResponseDto = {
  id: number
  name: string
  displayOrder: number
  /** Archived projects included. */
  projectCount: number
}

/** What happens to a deleted area's projects. The server accepts exactly one. */
export type AreaDeleteChoice = { moveToAreaId: number } | { newAreaName: string } | { noArea: true }

const JSON_HEADERS = { 'Content-Type': 'application/json' }
// See api/projects.ts: calls already reject on HTTP errors, THROW mainly types the response.
const THROW = { throwOnError: true } as const

export const getAreas = () =>
  client.get<{ 200: AreaResponseDto[] }, unknown, true>({
    url: '/api/v1/Areas',
    ...THROW,
  })

export const createArea = (name: string) =>
  client.post<{ 201: AreaResponseDto }, unknown, true>({
    url: '/api/v1/Areas',
    body: { name },
    headers: JSON_HEADERS,
    ...THROW,
  })

export const renameArea = (id: number, name: string) =>
  client.put<{ 200: AreaResponseDto }, unknown, true>({
    url: '/api/v1/Areas/{id}',
    path: { id },
    body: { name },
    headers: JSON_HEADERS,
    ...THROW,
  })

/** `areaIds` must hold every area id exactly once, in the new order. */
export const reorderAreas = (areaIds: number[]) =>
  client.put<{ 200: AreaResponseDto[] }, unknown, true>({
    url: '/api/v1/Areas/order',
    body: { areaIds },
    headers: JSON_HEADERS,
    ...THROW,
  })

export const deleteArea = (id: number, choice?: AreaDeleteChoice) =>
  client.delete<{ 204: void }, unknown, true>({
    url: '/api/v1/Areas/{id}',
    path: { id },
    query: choice,
    ...THROW,
  })

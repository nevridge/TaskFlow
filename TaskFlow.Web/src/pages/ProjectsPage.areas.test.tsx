import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import * as areasApi from '@/api/areas'
import * as projectsApi from '@/api/projects'
import { ProjectsPage } from './ProjectsPage'

vi.mock('@/api/areas', () => ({ getAreas: vi.fn() }))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn(), updateProject: vi.fn() }))

// Real query and mutation hooks: the order of refetch, pending state and row move is what is under test,
// and ProjectsPage.test.tsx replays it by hand with mocked hooks.
describe('ProjectsPage with the real hooks', () => {
  let areaId = 5

  beforeEach(() => {
    vi.resetAllMocks()
    areaId = 5
    vi.mocked(areasApi.getAreas).mockImplementation(
      async () =>
        ({
          data: [
            { id: 5, name: 'Work', displayOrder: 0, projectCount: 0 },
            { id: 6, name: 'Home', displayOrder: 1, projectCount: 0 },
          ],
        }) as never,
    )
    vi.mocked(projectsApi.getProjects).mockImplementation(
      async () =>
        ({
          data: [{ id: 1, name: 'Alpha', isArchived: false, areaId, openTaskCount: 0, completedTaskCount: 0 }],
        }) as never,
    )
    vi.mocked(projectsApi.updateProject).mockImplementation(async (_id, data) => {
      areaId = data.areaId as number
      return {} as never
    })
  })

  it('moves a saved project to its new group with focus on its Edit button', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    const row = screen.getByRole('button', { name: 'Save' }).closest('li')!
    await user.selectOptions(within(row).getByRole('combobox', { name: 'Area' }), 'Home')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    const order = () =>
      screen.getAllByRole('listitem').map(li => li.querySelector('h2, a')?.textContent ?? li.textContent)
    await waitFor(() => expect(order()).toEqual(['Work', 'No projects in this area yet.', 'Home', 'Alpha']))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Alpha' })).toHaveFocus())
  })
})

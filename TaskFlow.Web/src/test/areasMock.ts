// Stand-in for '@/hooks/useAreas' in tests that render area-aware components without a QueryClient:
//   vi.mock('@/hooks/useAreas', () => import('@/test/areasMock'))
// With no areas the project pickers stay flat.
const result = { data: { data: [] }, isLoading: false, isFetched: true, isError: false }

export const useAreasQuery = () => ({ ...result, refetch: async () => result })

const useIdleMutation = () => ({ mutateAsync: async () => ({ data: undefined }), isPending: false })

export const useCreateAreaMutation = useIdleMutation
export const useRenameAreaMutation = useIdleMutation
export const useReorderAreasMutation = useIdleMutation
export const useDeleteAreaMutation = useIdleMutation

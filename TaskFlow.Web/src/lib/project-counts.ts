import type { ProjectResponseDto } from '@/api/projects'

/** "7 open (2 blocked) · 3 completed"; the parenthetical appears only when something is blocked. */
export function formatProjectCounts(project: ProjectResponseDto): string {
  const blocked = Number(project.blockedCount ?? 0)
  return `${project.openTaskCount} open${blocked > 0 ? ` (${blocked} blocked)` : ''} · ${project.completedTaskCount} completed`
}

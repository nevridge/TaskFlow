export const PROJECT_NAME_MAX = 100
export const PROJECT_DESCRIPTION_MAX = 2000

export interface ProjectFormValues {
  name: string
  description: string
}

export interface ProjectFormErrors {
  name?: string
  description?: string
}

/** Validates on the trimmed name (the server trims it). Description is measured as-is. */
export function validateProject({ name, description }: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {}
  const trimmed = name.trim()
  if (!trimmed) errors.name = 'Name is required.'
  else if (trimmed.length > PROJECT_NAME_MAX) {
    errors.name = `Name must be ${PROJECT_NAME_MAX} characters or fewer.`
  }
  if (description.length > PROJECT_DESCRIPTION_MAX) {
    errors.description = `Description must be ${PROJECT_DESCRIPTION_MAX} characters or fewer.`
  }
  return errors
}

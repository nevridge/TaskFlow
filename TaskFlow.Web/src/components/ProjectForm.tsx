import { useEffect, useId, useRef, useState } from 'react'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  validateProject,
  type ProjectFormErrors,
} from '@/lib/project-validation'

export interface ProjectFormSubmit {
  name: string
  /** Trimmed-empty descriptions are sent as null, never "". */
  description: string | null
}

interface ProjectFormProps {
  initialName?: string
  initialDescription?: string | null
  submitLabel: string
  errorFallback: string
  /** Should reject on failure; the form shows the error and stays open. */
  onSubmit: (values: ProjectFormSubmit) => Promise<unknown>
  onCancel?: () => void
  resetOnSuccess?: boolean
  autoFocusName?: boolean
  disabled?: boolean
}

export function ProjectForm({
  initialName = '',
  initialDescription = '',
  submitLabel,
  errorFallback,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
  autoFocusName = false,
  disabled = false,
}: ProjectFormProps) {
  const uid = useId()
  const nameId = `${uid}-name`
  const descId = `${uid}-desc`
  const nameErrId = `${uid}-name-err`
  const descErrId = `${uid}-desc-err`
  const submitErrId = `${uid}-submit-err`
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [errors, setErrors] = useState<ProjectFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (autoFocusName) nameRef.current?.focus()
  }, [autoFocusName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const found = validateProject({ name, description })
    setErrors(found)
    setSubmitError(null)
    if (found.name || found.description) return
    setSubmitting(true)
    try {
      // Only a whitespace-only description becomes null; otherwise send it as typed so
      // the payload matches what validation measured.
      await onSubmit({ name: name.trim(), description: description.trim() ? description : null })
      if (resetOnSuccess) {
        setName('')
        setDescription('')
      }
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, errorFallback))
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || disabled

  return (
    <form
      className="p-form"
      onSubmit={handleSubmit}
      noValidate
      aria-describedby={submitError ? submitErrId : undefined}
    >
      <div className="p-field">
        <label className="p-label" htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          ref={nameRef}
          className="p-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrId : undefined}
        />
        <span className="p-counter" aria-hidden="true">{name.trim().length}/{PROJECT_NAME_MAX}</span>
        {errors.name && <p id={nameErrId} className="p-field-error" role="alert">{errors.name}</p>}
      </div>
      <div className="p-field">
        <label className="p-label" htmlFor={descId}>Description</label>
        <textarea
          id={descId}
          className="p-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? descErrId : undefined}
        />
        <span className="p-counter" aria-hidden="true">{description.length}/{PROJECT_DESCRIPTION_MAX}</span>
        {errors.description && (
          <p id={descErrId} className="p-field-error" role="alert">{errors.description}</p>
        )}
      </div>
      {submitError && <p id={submitErrId} className="p-error" role="alert">{submitError}</p>}
      <div className="p-form-actions">
        <button type="submit" className="p-btn p-btn--primary" disabled={busy}>{submitLabel}</button>
        {onCancel && (
          <button type="button" className="p-btn" onClick={onCancel} disabled={submitting}>Cancel</button>
        )}
      </div>
    </form>
  )
}

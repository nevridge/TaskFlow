import { type FormEvent, useState } from 'react'
import type { NoteResponseDto, CreateNoteDto } from '@/api/client/types.gen'

interface Props {
  note?: NoteResponseDto
  onSubmit: (data: CreateNoteDto) => void
  onCancel: () => void
}

export function NoteForm({ note, onSubmit, onCancel }: Props) {
  const [content, setContent] = useState(note?.content ?? '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ content })
  }

  return (
    <form onSubmit={handleSubmit} className="t-form">
      <div className="t-field">
        <label htmlFor="content" className="t-label">Content</label>
        <textarea
          id="content"
          className="t-input"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          required
        />
      </div>
      <div className="t-form-actions">
        <button type="button" className="t-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="t-btn-primary">Save</button>
      </div>
    </form>
  )
}

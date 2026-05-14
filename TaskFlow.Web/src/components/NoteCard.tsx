import { formatDate } from '@/lib/utils'
import type { NoteResponseDto } from '@/api/client/types.gen'

interface Props {
  note: NoteResponseDto
  onEdit: (note: NoteResponseDto) => void
  onDelete: (note: NoteResponseDto) => void
}

export function NoteCard({ note, onEdit, onDelete }: Props) {
  return (
    <div className="t-note-card">
      <p className="t-note-content">{note.content}</p>
      <div className="t-note-footer">
        <span className="t-note-date">{formatDate(note.createdAt)}</span>
        <div className="t-note-actions">
          <button className="t-btn" aria-label="Edit" onClick={() => onEdit(note)}>Edit</button>
          <button className="t-btn-danger" aria-label="Delete" onClick={() => onDelete(note)}>Delete</button>
        </div>
      </div>
    </div>
  )
}

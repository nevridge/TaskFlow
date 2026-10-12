import { Fragment, useMemo } from 'react'
import { parseNoteContent } from '@/lib/notes-format'

interface Props {
  text: string
}

export function NoteContent({ text }: Props) {
  const blocks = useMemo(() => parseNoteContent(text), [text])

  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'paragraph') {
          return (
            <p key={i} className="note-p">
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </p>
          )
        }
        const Tag = block.type
        return (
          <Tag key={i} className="note-list">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </Tag>
        )
      })}
    </>
  )
}

import { Navigate, Routes, Route } from 'react-router-dom'
import { TasksPage } from '@/pages/TasksPage'
import { TaskDetailPage } from '@/pages/TaskDetailPage'
import { JournalPage } from '@/pages/JournalPage'
import { todayUrlDate } from '@/lib/journal-utils'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/journal/${todayUrlDate()}`} replace />} />
      <Route path="/journal/:date" element={<JournalPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/tasks/:id" element={<TaskDetailPage />} />
    </Routes>
  )
}

export default App

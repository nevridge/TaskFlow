import { Navigate, Routes, Route } from 'react-router-dom'
import { TasksPage } from '@/pages/TasksPage'
import { TaskDetailPage } from '@/pages/TaskDetailPage'
import { JournalPage } from '@/pages/JournalPage'
import { Layout } from '@/components/Layout'
import { PrefsProvider } from '@/context/PrefsContext'
import { todayUrlDate } from '@/lib/journal-utils'

function App() {
  return (
    <PrefsProvider>
      <Routes>
        <Route path="/" element={<Navigate to={`/journal/${todayUrlDate()}`} replace />} />
        <Route element={<Layout />}>
          <Route path="/journal/:date" element={<JournalPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Route>
      </Routes>
    </PrefsProvider>
  )
}

export default App

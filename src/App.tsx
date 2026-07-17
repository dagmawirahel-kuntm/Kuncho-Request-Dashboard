import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { FiscalYearProvider } from '@/contexts/FiscalYearContext'
import { router } from '@/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <FiscalYearProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </FiscalYearProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/500.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import InvoiceList from './pages/InvoiceList.tsx'
import InvoiceNew from './pages/InvoiceNew.tsx'
import InvoiceDetail from './pages/InvoiceDetail.tsx'
import InvoiceEdit from './pages/InvoiceEdit.tsx'
import Login from './pages/Login.tsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <InvoiceList /> },
      { path: 'invoices/new', element: <InvoiceNew /> },
      { path: 'invoices/:id', element: <InvoiceDetail /> },
      { path: 'invoices/:id/edit', element: <InvoiceEdit /> },
      { path: 'login', element: <Login /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

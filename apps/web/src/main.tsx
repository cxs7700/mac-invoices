import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/500.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import './index.css'
import './lib/i18n' // initialize i18next once, before the first render
import { initTheme } from './lib/theme'
import App from './App.tsx'
import { AuthGuard } from './components/AuthGuard.tsx'
import { queryClient } from './lib/queryClient'
import Login from './pages/Login.tsx'
import Dashboard from './pages/Dashboard.tsx'
import InvoiceList from './pages/InvoiceList.tsx'
import InvoiceNew from './pages/InvoiceNew.tsx'
import InvoiceDetail from './pages/InvoiceDetail.tsx'
import InvoiceEdit from './pages/InvoiceEdit.tsx'
import VendorSubmit from './pages/VendorSubmit.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Vendors from './pages/Vendors.tsx'
import Properties from './pages/Properties.tsx'
import PropertyDetail from './pages/PropertyDetail.tsx'
import PropertyEdit from './pages/PropertyEdit.tsx'
import Settings from './pages/Settings.tsx'

// The index.html boot script stamped the first-paint theme; this wires the
// live OS-preference listener for the `system` choice.
initTheme()

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  // Public, no-login vendor submission link — a top-level sibling of /login,
  // deliberately OUTSIDE the AuthGuard subtree. Authorization is the path token.
  { path: '/submit/:token', element: <VendorSubmit /> },
  // Public reset page — outside AuthGuard, because the person using it is
  // locked out by definition. The token is in the fragment, so it never
  // reaches the server's access logs.
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/',
    element: <AuthGuard />,
    children: [
      {
        element: <App />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'invoices', element: <InvoiceList /> },
          { path: 'invoices/new', element: <InvoiceNew /> },
          { path: 'invoices/:id', element: <InvoiceDetail /> },
          { path: 'invoices/:id/edit', element: <InvoiceEdit /> },
          { path: 'contractors', element: <Navigate to="/vendors" replace /> },
          { path: 'vendors', element: <Vendors /> },
          { path: 'properties', element: <Properties /> },
          { path: 'properties/:id', element: <PropertyDetail /> },
          { path: 'properties/:id/edit', element: <PropertyEdit /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
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

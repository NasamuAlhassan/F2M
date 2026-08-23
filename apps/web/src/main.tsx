import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { getToken } from './api';
import { Layout } from './components/Layout';
import './index.css';
import { ContractDetailPage } from './pages/ContractDetail';
import { DemandDetailPage } from './pages/DemandDetail';
import { DemandsPage } from './pages/Demands';
import { DriverJobsPage } from './pages/DriverJobs';
import { DriverLoginPage } from './pages/DriverLogin';
import { LoginPage } from './pages/Login';
import { PricesPage } from './pages/Prices';
import { TracePage } from './pages/Trace';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

function RequireAuth() {
  return getToken() ? <Outlet /> : <Navigate to="/login" replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/driver/login', element: <DriverLoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Navigate to="/demands" replace /> },
          { path: '/demands', element: <DemandsPage /> },
          { path: '/prices', element: <PricesPage /> },
          { path: '/driver/jobs', element: <DriverJobsPage /> },
          { path: '/demands/:id', element: <DemandDetailPage /> },
          { path: '/contracts/:id', element: <ContractDetailPage /> },
          { path: '/lots/:id/trace', element: <TracePage /> },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

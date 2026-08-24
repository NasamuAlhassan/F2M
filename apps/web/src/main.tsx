import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { getToken } from './api';
import { Layout } from './components/Layout';
import './index.css';
import { ContractDetailPage } from './pages/ContractDetail';
import { ContractsPage } from './pages/Contracts';
import { DemandDetailPage } from './pages/DemandDetail';
import { DriverJobsPage } from './pages/DriverJobs';
import { DriverLoginPage } from './pages/DriverLogin';
import { FarmerDashboardPage } from './pages/FarmerDashboard';
import { FarmerLoginPage } from './pages/FarmerLogin';
import { LoginPage } from './pages/Login';
import { MarketplacePage } from './pages/Marketplace';
import { OrdersPage } from './pages/Orders';
import { PricesPage } from './pages/Prices';
import { PublicTracePage } from './pages/PublicTrace';
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
  { path: '/farmer/login', element: <FarmerLoginPage /> },
  // The QR destination — public by design (D-033), no auth wrapper.
  { path: '/t/:lotId', element: <PublicTracePage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Navigate to="/market" replace /> },
          { path: '/market', element: <MarketplacePage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/contracts', element: <ContractsPage /> },
          { path: '/prices', element: <PricesPage /> },
          { path: '/driver/jobs', element: <DriverJobsPage /> },
          { path: '/farmer/dashboard', element: <FarmerDashboardPage /> },
          { path: '/demands/:id', element: <DemandDetailPage /> },
          { path: '/contracts/:id', element: <ContractDetailPage /> },
          { path: '/lots/:id/trace', element: <TracePage /> },
          // M26 consolidation — old URLs stay alive (deploying live, no dead links).
          { path: '/demands', element: <Navigate to="/orders" replace /> },
          { path: '/engine', element: <Navigate to="/orders" replace /> },
          { path: '/consolidate', element: <Navigate to="/market?mode=pool" replace /> },
          { path: '/traceability', element: <Navigate to="/contracts" replace /> },
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

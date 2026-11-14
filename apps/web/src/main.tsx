import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import type { Role } from './api';
import { Layout } from './components/Layout';
import { HOME_FOR, useAccount } from './lib/session';
import './index.css';

// Route-level code splitting: each page ships as its own chunk, so a phone on
// mobile data pays only for the surface it opens (the QR library, for one,
// rides the contract/trace chunks instead of the login path).
const page = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
): React.LazyExoticComponent<React.ComponentType> =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const LoginPage = page(() => import('./pages/Login'), 'LoginPage');
const PublicTracePage = page(() => import('./pages/PublicTrace'), 'PublicTracePage');
const MarketplacePage = page(() => import('./pages/Marketplace'), 'MarketplacePage');
const OrdersPage = page(() => import('./pages/Orders'), 'OrdersPage');
const ContractsPage = page(() => import('./pages/Contracts'), 'ContractsPage');
const PricesPage = page(() => import('./pages/Prices'), 'PricesPage');
const DriverJobsPage = page(() => import('./pages/DriverJobs'), 'DriverJobsPage');
const FarmerDashboardPage = page(() => import('./pages/FarmerDashboard'), 'FarmerDashboardPage');
const DemandDetailPage = page(() => import('./pages/DemandDetail'), 'DemandDetailPage');
const ContractDetailPage = page(() => import('./pages/ContractDetail'), 'ContractDetailPage');
const TracePage = page(() => import('./pages/Trace'), 'TracePage');
const PhonePage = page(() => import('./pages/Phone'), 'PhonePage');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

// One signed-in person per browser (D-047): a Supabase login linked to one
// F2M role. A group that names a role admits only that role, sending anyone
// else to their own home; the unnamed group (/prices) admits any role.
// Waiting on the account matters: the session check is async, and deciding
// before it lands would bounce a signed-in person to /login on every refresh.
function RequireAuth({ role }: { role?: Role }) {
  const { loading, account } = useAccount();
  if (loading) return <PageLoading />;
  if (!account) return <Navigate to="/login" replace />;
  if (role && account.role !== role) return <Navigate to={HOME_FOR[account.role]} replace />;
  return <Outlet />;
}

// The chunk-load interstitial, in the world's own voice.
function PageLoading() {
  return <p className="smallcaps p-6 text-[var(--ink-6)]">Loading…</p>;
}

const withSuspense = (el: React.ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: withSuspense(<LoginPage />) },
  // Old per-role login links stay alive (deploying live, no dead links).
  { path: '/driver/login', element: <Navigate to="/login" replace /> },
  { path: '/farmer/login', element: <Navigate to="/login" replace /> },
  { path: '/auth', element: <Navigate to="/login" replace /> },
  // The QR destination — public by design (D-033), no auth wrapper.
  { path: '/t/:lotId', element: withSuspense(<PublicTracePage />) },
  // The handset simulator has no web login — a phone identifies itself by the
  // number it dials from, exactly as it does on a real shortcode.
  { path: '/phone', element: withSuspense(<PhonePage />) },
  {
    element: <RequireAuth role="buyer" />,
    children: [
      {
        element: <Layout role="buyer" />,
        children: [
          { path: '/', element: <Navigate to="/market" replace /> },
          { path: '/market', element: withSuspense(<MarketplacePage />) },
          { path: '/orders', element: withSuspense(<OrdersPage />) },
          { path: '/contracts', element: withSuspense(<ContractsPage />) },
          { path: '/demands/:id', element: withSuspense(<DemandDetailPage />) },
          { path: '/contracts/:id', element: withSuspense(<ContractDetailPage />) },
          { path: '/lots/:id/trace', element: withSuspense(<TracePage />) },
          // M26 consolidation — old URLs stay alive (deploying live, no dead links).
          { path: '/demands', element: <Navigate to="/orders" replace /> },
          { path: '/engine', element: <Navigate to="/orders" replace /> },
          { path: '/consolidate', element: <Navigate to="/market?mode=pool" replace /> },
          { path: '/traceability', element: <Navigate to="/contracts" replace /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth role="farmer" />,
    children: [
      {
        element: <Layout role="farmer" />,
        children: [{ path: '/farmer/dashboard', element: withSuspense(<FarmerDashboardPage />) }],
      },
    ],
  },
  {
    element: <RequireAuth role="driver" />,
    children: [
      {
        element: <Layout role="driver" />,
        children: [{ path: '/driver/jobs', element: withSuspense(<DriverJobsPage />) }],
      },
    ],
  },
  // Prices belongs to no single role — the buyer and the farmer both link to it.
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [{ path: '/prices', element: withSuspense(<PricesPage />) }],
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

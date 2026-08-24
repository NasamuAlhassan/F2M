import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { activeRole, getToken, loginPathFor, type Role } from './api';
import { Layout } from './components/Layout';
import { useAuth } from './hooks/useAuth';
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
const DriverLoginPage = page(() => import('./pages/DriverLogin'), 'DriverLoginPage');
const FarmerLoginPage = page(() => import('./pages/FarmerLogin'), 'FarmerLoginPage');
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
const AuthPage = page(() => import('./pages/Auth'), 'AuthPage');
const BuyerHomePage = page(() => import('./pages/BuyerHome'), 'BuyerHomePage');
const SellerHomePage = page(() => import('./pages/SellerHome'), 'SellerHomePage');
const DriverHomePage = page(() => import('./pages/DriverHome'), 'DriverHomePage');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

// Auth is checked per role, because every tab carries its own identity — the
// buyer portal, the seller desk and the dispatch board are meant to be open at
// once. A group that names a role demands that role's token; the unnamed group
// (/prices, which buyer and farmer both link to) accepts whichever identity
// this tab happens to hold.
function RequireAuth({ role }: { role?: Role }) {
  if (role) return getToken(role) ? <Outlet /> : <Navigate to={loginPathFor(role)} replace />;
  return activeRole() ? <Outlet /> : <Navigate to="/login" replace />;
}

// The new unified-signup identity (supabase/README.md) — separate from the
// role-keyed JWT system above. useAuth()'s loading window matters here: a
// Supabase session check is async, so redirecting before it resolves would
// bounce a genuinely signed-in person back to /auth on every refresh.
function RequireSupabaseAuth() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoading />;
  return session ? <Outlet /> : <Navigate to="/auth" replace />;
}

// The chunk-load interstitial, in the world's own voice.
function PageLoading() {
  return <p className="smallcaps p-6 text-[var(--ink-6)]">Loading…</p>;
}

const withSuspense = (el: React.ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: withSuspense(<LoginPage />) },
  { path: '/driver/login', element: withSuspense(<DriverLoginPage />) },
  { path: '/farmer/login', element: withSuspense(<FarmerLoginPage />) },
  // The QR destination — public by design (D-033), no auth wrapper.
  { path: '/t/:lotId', element: withSuspense(<PublicTracePage />) },
  // The handset simulator has no web login — a phone identifies itself by the
  // number it dials from, exactly as it does on a real shortcode.
  { path: '/phone', element: withSuspense(<PhonePage />) },
  // The unified role-picker signup/login (supabase/README.md). Runs
  // alongside the role-keyed JWT system above, not in place of it — see
  // that README for what still needs reconciling between the two.
  { path: '/auth', element: withSuspense(<AuthPage />) },
  {
    element: <RequireSupabaseAuth />,
    children: [
      { path: '/app/buyer', element: withSuspense(<BuyerHomePage />) },
      { path: '/app/seller', element: withSuspense(<SellerHomePage />) },
      { path: '/app/driver', element: withSuspense(<DriverHomePage />) },
    ],
  },
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

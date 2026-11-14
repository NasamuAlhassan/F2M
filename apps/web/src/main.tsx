import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from 'react-router-dom';
import type { Role } from './api';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui';
import { I18nProvider } from './lib/i18n';
import { HOME_FOR, useAccount } from './lib/session';
import './index.css';

// Route-level code splitting: each page ships as its own chunk, so a phone on
// mobile data pays only for the surface it opens (the QR library, for one,
// rides the contract/trace chunks instead of the login path).
//
// Pages load through the router's own `lazy`, not React.lazy + Suspense: the
// router fetches the next page's code BEFORE it switches, so the current page
// stays on screen until the new one is ready. With React.lazy every first
// visit to a tab flashed "Loading…" in place of the page.
const pages = {
  landing: () => import('./pages/Landing').then((m) => ({ Component: m.LandingPage })),
  notFound: () => import('./pages/NotFound').then((m) => ({ Component: m.NotFoundPage })),
  login: () => import('./pages/Login').then((m) => ({ Component: m.LoginPage })),
  publicTrace: () => import('./pages/PublicTrace').then((m) => ({ Component: m.PublicTracePage })),
  market: () => import('./pages/Marketplace').then((m) => ({ Component: m.MarketplacePage })),
  orders: () => import('./pages/Orders').then((m) => ({ Component: m.OrdersPage })),
  contracts: () => import('./pages/Contracts').then((m) => ({ Component: m.ContractsPage })),
  prices: () => import('./pages/Prices').then((m) => ({ Component: m.PricesPage })),
  driverJobs: () => import('./pages/DriverJobs').then((m) => ({ Component: m.DriverJobsPage })),
  farmerDashboard: () => import('./pages/FarmerDashboard').then((m) => ({ Component: m.FarmerDashboardPage })),
  demandDetail: () => import('./pages/DemandDetail').then((m) => ({ Component: m.DemandDetailPage })),
  contractDetail: () => import('./pages/ContractDetail').then((m) => ({ Component: m.ContractDetailPage })),
  trace: () => import('./pages/Trace').then((m) => ({ Component: m.TracePage })),
  phone: () => import('./pages/Phone').then((m) => ({ Component: m.PhonePage })),
  deal: () => import('./pages/Deal').then((m) => ({ Component: m.DealPage })),
};

// Once the first page is up and the browser is idle, fetch the other pages'
// code too, so even the first tap on a tab switches without waiting.
function warmPages() {
  const run = () => Object.values(pages).forEach((load) => void load().catch(() => undefined));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

// One signed-in person per browser (D-047): a Supabase login linked to one
// F2M role. With a role named, only that role passes and anyone else goes to
// their own home; with none (/prices) any signed-in role passes.
// Waiting on the account matters: the session check is async, and deciding
// before it lands would bounce a signed-in person to /login on every refresh.
function RequireAuth({ role }: { role?: Role }) {
  const { loading, account } = useAccount();
  if (loading) return <PageLoading />;
  if (!account) return <Navigate to="/login" replace />;
  if (role && account.role !== role) return <Navigate to={HOME_FOR[account.role]} replace />;
  return <Outlet />;
}

// Shown only for the very first page of a visit, while its code arrives.
function PageLoading() {
  return <p className="p-6 text-sm text-[var(--ink-6)]">Loading…</p>;
}

// Root: scroll restoration for every page. A new page opens at the top; Back
// and Forward return to where you were.
function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    HydrateFallback: PageLoading,
    children: [
      // The public front door (D-048); a signed-in person sees "Open your desk".
      { path: '/', lazy: pages.landing },
      { path: '/login', lazy: pages.login },
      // Old per-role login links stay alive (deploying live, no dead links).
      { path: '/driver/login', element: <Navigate to="/login" replace /> },
      { path: '/farmer/login', element: <Navigate to="/login" replace /> },
      { path: '/auth', element: <Navigate to="/login" replace /> },
      // The QR destination, public by design (D-033), no auth wrapper.
      { path: '/t/:lotId', lazy: pages.publicTrace },
      // The handset simulator has no web login: a phone identifies itself by
      // the number it dials from, exactly as it does on a real shortcode.
      { path: '/phone', lazy: pages.phone },
      {
        // One signed-in shell for every role, so moving between tabs (Prices
        // included) keeps the same header and its sliding tab highlight.
        element: <RequireAuth />,
        children: [
          {
            element: <Layout />,
            children: [
              {
                element: <RequireAuth role="buyer" />,
                children: [
                  { path: '/market', lazy: pages.market },
                  { path: '/orders', lazy: pages.orders },
                  { path: '/contracts', lazy: pages.contracts },
                  { path: '/demands/:id', lazy: pages.demandDetail },
                  { path: '/contracts/:id', lazy: pages.contractDetail },
                  { path: '/lots/:id/trace', lazy: pages.trace },
                  // M26 consolidation: old URLs stay alive (deploying live, no dead links).
                  { path: '/demands', element: <Navigate to="/orders" replace /> },
                  { path: '/engine', element: <Navigate to="/orders" replace /> },
                  { path: '/consolidate', element: <Navigate to="/market?mode=pool" replace /> },
                  { path: '/traceability', element: <Navigate to="/contracts" replace /> },
                ],
              },
              {
                element: <RequireAuth role="farmer" />,
                children: [{ path: '/farmer/dashboard', lazy: pages.farmerDashboard }],
              },
              {
                element: <RequireAuth role="driver" />,
                children: [{ path: '/driver/jobs', lazy: pages.driverJobs }],
              },
              // Prices belongs to no single role: the buyer and the farmer both link to it.
              { path: '/prices', lazy: pages.prices },
              // One sale, one page, whoever you are in it: the server decides who may see it.
              { path: '/deals/:id', lazy: pages.deal },
            ],
          },
        ],
      },
      // A mistyped or stale link lands somewhere friendly, not on a blank page.
      { path: '*', lazy: pages.notFound },
    ],
  },
]);

warmPages();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
        <Toaster />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigation, useSearchParams } from 'react-router-dom';
import { api, dateTime, type LocaleInfo, type MarketLot, type Role } from '../api';
import { useT } from '../lib/i18n';
import { useLiveUpdates } from '../lib/live';
import { signOut, useAccount } from '../lib/session';
import { POLL } from '../poll';
import { F2MSeal, Glyph } from './engrave';
import { SkipLink } from './SkipLink';
import { pillItemCls, SlidingPillGroup } from './SlidingPill';
import { BusyLabel, hitAreaCls, plateBtnCls, quietBtnCls, textLinkCls } from './ui';
import { useScrolled } from '../lib/useScrolled';

interface NotificationRow {
  id: string;
  message: string;
  contractId: string | null;
  readAt: number | null;
  createdAt: number;
}

// The language switch, driven by the server's locale registry (D-040): a live
// language can be picked for these screens (D-050); the rest stay visibly
// present but disabled — the D-029 convention.
function LangLegend() {
  const { code, setCode, t } = useT();
  const { data } = useQuery({
    queryKey: ['locales'],
    queryFn: () => api<{ locales: LocaleInfo[] }>('/api/i18n/locales'),
    staleTime: 60_000,
  });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label={t('web.language.switch', 'Language')}>
      {(data?.locales ?? [{ code: 'en', label: 'English', endonym: 'English', reviewed: true, live: true }]).map((l) =>
        l.live ? (
          <button
            key={l.code}
            type="button"
            aria-pressed={code === l.code}
            onClick={() => setCode(l.code)}
            className={`smallcaps inline-flex min-h-11 items-center underline decoration-2 underline-offset-[6px] transition-[color,text-decoration-color] active:opacity-70 lg:min-h-8 ${
              code === l.code
                ? 'text-[var(--ink)] decoration-[var(--gold)]'
                : 'text-[var(--ink-6)] decoration-transparent hover:text-[var(--ink)] hover:decoration-[var(--ink-3)]'
            }`}
          >
            {l.endonym}
          </button>
        ) : (
          // Not switched on: dimmed and dotted so it can't be mistaken for an
          // unselected language, and the reason is read out, not only hovered.
          <span
            key={l.code}
            aria-disabled="true"
            className="smallcaps cursor-not-allowed text-[var(--ink-6)] underline decoration-dotted underline-offset-4 opacity-50"
            title={t('web.language.lockedHint', 'Not switched on yet. It is waiting for a native speaker to check it.')}
          >
            {l.label}
            <span className="sr-only"> {t('web.language.lockedShort', '(not switched on yet)')}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** The engine's alerts, filed like incoming correspondence. */
function NotificationBell() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Escape and outside-click both file the tray away — same manners as a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; notifications: NotificationRow[] }>('/api/notifications'),
    refetchInterval: POLL.ambient,
  });
  const markRead = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Alerts${unread > 0 ? `, ${unread} unread` : ''}`}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border transition-[background-color,color,scale] active:scale-[0.97] lg:h-10 lg:w-10 ${
          open
            ? 'border-[var(--forest-night)] bg-[var(--forest-night)] text-[var(--paper-lift)]'
            : 'border-[var(--ink-2)] bg-[var(--paper-lift)] text-[var(--ink-7)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:bg-[var(--paper-deep)]'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <Glyph name="bell" className="h-4 w-4" />
        {unread > 0 && (
          <span className="serial absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--gold)] px-1 text-[11px] font-bold text-[var(--ink)]">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="certificate absolute right-0 z-30 mt-3 w-[min(24rem,calc(100vw-2rem))] overflow-hidden bg-[var(--paper-lift)] text-[var(--ink)]">
          <div className="plate on-dark flex items-center justify-between px-5 py-4">
            <div>
              <div className="headline text-xl">{t('web.alerts.title', 'Alerts')}</div>
            </div>
            {unread > 0 && (
              <button
                type="button"
                className={plateBtnCls}
                onClick={() => markRead.mutate()}
                disabled={markRead.isPending}
                aria-busy={markRead.isPending || undefined}
              >
                <BusyLabel busy={markRead.isPending} label={t('web.alerts.markRead', 'Mark all read')} />
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-5 py-4 text-sm text-[var(--ink-6)]">Nothing filed yet — alerts land as the engine works.</p>
            ) : (
              data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-[var(--ink-2)] px-5 py-3 text-sm last:border-b-0 ${
                    n.readAt ? 'text-[var(--ink-6)]' : 'text-[var(--ink)]'
                  }`}
                >
                  <p className="leading-snug">{n.message}</p>
                  <p className="mt-1 flex items-baseline justify-between">
                    <span className="serial text-[11px] text-[var(--ink-6)]">{dateTime(n.createdAt)}</span>
                    {n.contractId && (
                      <Link
                        to={`/deals/${n.contractId}`}
                        viewTransition
                        className={`${textLinkCls} ${hitAreaCls} text-xs font-semibold text-[var(--gold-deep)]`}
                        onClick={() => setOpen(false)}
                      >
                        View contract
                      </Link>
                    )}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The floating pill nav (D-048): the active tab is a filled deep-green pill.
function navCls({ isActive }: { isActive: boolean }): string {
  // The filled pill behind the active tab is SlidingPillGroup's indicator,
  // which slides between tabs; the link itself only changes its text colour.
  return pillItemCls(isActive);
}

/** True while a text field has focus, which on a phone means the keyboard is
 *  up. The tab bar steps aside then, so it never rides on top of the keyboard
 *  or covers the field being typed in. */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isTextEntry = (el: EventTarget | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type)) ||
      (el instanceof HTMLElement && el.isContentEditable);
    const onIn = (e: FocusEvent) => setTyping(isTextEntry(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

/** When the phone loses its signal: when it went, so the page can say how old
 *  what is on screen is. Null while online. */
function useOfflineSince(): number | null {
  const [since, setSince] = useState<number | null>(() => (typeof navigator !== 'undefined' && !navigator.onLine ? Date.now() : null));
  useEffect(() => {
    const off = () => setSince((s) => s ?? Date.now());
    const on = () => setSince(null);
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);
  return since;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

// filter(Boolean) before the map: a doubled or trailing underscore yields an
// empty segment, and w[0]! on that is a TypeError that takes the whole header
// down — the one place a malformed registry code could blank the app.
const prettyRegion = (code: string | null): string =>
  code
    ? code
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(' ')
    : '';

export function Layout({ role: routeRole }: { role?: Role }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  // One signed-in person per browser (D-047); the route's role is only a
  // fallback while the account loads (RequireAuth has already checked it).
  const { account } = useAccount();
  const role: Role = account?.role ?? routeRole ?? 'buyer';
  // Screens refresh the moment the market changes, not on the next poll (D-054).
  const live = useLiveUpdates(Boolean(account));
  const { data: market } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    enabled: role === 'buyer',
    refetchInterval: POLL.slow,
  });

  const displayName = account?.name || (role === 'driver' ? 'Driver' : role === 'farmer' ? 'Farmer' : 'Buyer');
  const lotCount = market?.lots.length ?? null;

  // The browser tab names the page, so a buyer with three tabs open can tell
  // Orders from Contracts at a glance; live offers/alerts lead the title.
  const { pathname } = useLocation();
  // A page whose code is still arriving: show a hairline, not a blank page.
  const navigating = useNavigation().state !== 'idle';
  const scrolled = useScrolled();
  const { t } = useT();
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const titles: Array<[RegExp, string]> = [
      [/^\/market/, t('web.tab.market', 'Marketplace')],
      [/^\/orders/, t('web.tab.orders', 'Orders')],
      [/^\/contracts\/./, t('web.tab.contract', 'Contract')],
      [/^\/contracts/, t('web.tab.contracts', 'Contracts')],
      [/^\/demands\//, t('web.tab.demand', 'Demand')],
      [/^\/lots\/.+\/trace/, t('web.tab.trace', 'Lot trace')],
      [/^\/prices/, t('web.tab.prices', 'Prices')],
      [/^\/farmer/, t('web.tab.sellerDesk', 'Seller desk')],
      [/^\/driver/, t('web.tab.dispatch', 'Dispatch board')],
    ];
    const name = titles.find(([re]) => re.test(pathname))?.[1];
    document.title = name ? `${name} · Farm to Market` : 'Farm to Market';
  }, [pathname, t]);
  const homePath = role === 'driver' ? '/driver/jobs' : role === 'farmer' ? '/farmer/dashboard' : '/market';

  const sections: Array<{ to: string; label: string; icon: string }> =
    role === 'driver'
      ? [{ to: '/driver/jobs', label: t('web.tab.dispatch', 'Dispatch board'), icon: 'route' }]
      : role === 'farmer'
        ? [
            { to: '/farmer/dashboard', label: t('web.tab.sellerDesk', 'Seller desk'), icon: 'home' },
            { to: '/prices', label: t('web.tab.prices', 'Prices'), icon: 'chart' },
          ]
        : [
            { to: '/market', label: t('web.tab.market', 'Marketplace'), icon: 'basket' },
            { to: '/orders', label: t('web.tab.orders', 'Orders'), icon: 'list' },
            { to: '/contracts', label: t('web.tab.contracts', 'Contracts'), icon: 'document' },
            { to: '/prices', label: t('web.tab.prices', 'Prices'), icon: 'chart' },
          ];
  // Phones get a bottom tab bar when there is more than one place to go: every
  // section stays in view and in reach (a sideways-scrolling row hid Prices).
  const tabBar = sections.length > 1;
  const typing = useTyping();
  const offlineSince = useOfflineSince();
  // Toasts sit above the tab bar instead of on it (ui.tsx reads this).
  useEffect(() => {
    if (!tabBar) return;
    const root = document.documentElement;
    const mq = window.matchMedia('(min-width: 64rem)');
    const apply = () => root.style.setProperty('--tabbar-h', mq.matches ? '0px' : '4rem');
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      root.style.removeProperty('--tabbar-h');
    };
  }, [tabBar]);
  const nav = sections.map((s) => (
    <NavLink key={s.to} to={s.to} viewTransition className={navCls}>
      {s.label}
    </NavLink>
  ));

  const setQuery = (q: string) => {
    // Carry the other params through: rebuilding the URL from scratch dropped
    // ?mode=pool, so typing one character threw the buyer out of the Pool Builder.
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q);
    else next.delete('q');
    navigate({ pathname: '/market', search: next.toString() }, { replace: true });
  };

  return (
    <div
      className={`flex min-h-screen flex-col bg-[var(--paper)] ${tabBar ? 'pb-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:pb-0' : ''}`}
    >
      <SkipLink />
      {navigating && <span aria-hidden className="nav-progress" />}
      <header
        // Held still while the page changes (index.css, view transitions).
        className={`vt-header sticky top-0 z-20 border-b bg-[var(--paper)]/85 backdrop-blur-md transition-[border-color,box-shadow] duration-[var(--dur-base)] ${
          scrolled
            ? 'border-[var(--ink-1)] shadow-[0_1px_0_rgba(40,30,15,0.03),0_8px_24px_-18px_rgba(40,30,15,0.35)]'
            : 'border-transparent'
        }`}
      >
        <div className="mx-auto flex min-h-16 max-w-[1400px] items-center gap-x-4 px-4 py-2.5 sm:px-6 lg:min-h-[72px] lg:py-3">
          <Link
            to={homePath}
            className="flex flex-shrink-0 min-h-11 items-center gap-2.5 rounded-full transition-opacity hover:opacity-85 active:opacity-70"
            aria-label="Farm to Market, home"
          >
            <F2MSeal className="h-10 w-10" />
            <span className="hidden text-lg font-extrabold uppercase leading-none tracking-[0.04em] text-[var(--forest-deep)] min-[420px]:inline lg:hidden xl:inline">
              Farm to Market
            </span>
          </Link>

          {/* Desktop: the nav floats in its own pill. Phones use the tab bar
              at the bottom instead (or, with one section, need no nav). */}
          <SlidingPillGroup
            as="nav"
            watch={pathname}
            aria-label={t('web.nav.main', 'Main')}
            className="mx-auto hidden gap-1 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)]/70 p-1 shadow-sm lg:flex"
          >
            {nav}
          </SlidingPillGroup>

          <div className="ml-auto flex flex-shrink-0 items-center gap-2 lg:ml-0">
            {role === 'buyer' && (
              <div className="relative hidden md:block">
                <Glyph
                  name="search"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-5)]"
                />
                <input
                  type="search"
                  aria-label={t('web.nav.search', 'Search crops and regions')}
                  enterKeyHint="search"
                  className="h-10 w-44 rounded-full xl:w-56 border border-[var(--field-border)] bg-[var(--paper-lift)] pl-10 pr-4 text-sm text-[var(--ink)] transition-[border-color] hover:border-[var(--ink-7)] focus:border-[var(--forest)]"
                  placeholder={t('web.nav.searchShort', 'Search crops…')}
                  value={searchParams.get('q') ?? ''}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            {role === 'buyer' && <NotificationBell />}
            <div className="flex items-center gap-2.5 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] p-1 xl:pr-3.5">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--forest-night)] text-xs font-bold text-[var(--paper-lift)]"
              >
                {initials(displayName)}
              </span>
              <div className="hidden leading-tight xl:block">
                <div className="max-w-[10rem] truncate text-sm font-semibold text-[var(--ink)]">{displayName}</div>
                <div className="text-[11px] text-[var(--ink-6)]">
                  {/* No verification exists yet (D-047): say the role, not a claim. */}
                  {`${role === 'driver' ? 'Driver' : role === 'farmer' ? 'Farmer' : 'Buyer'}${
                    account?.regionCode ? ` · ${prettyRegion(account.regionCode)}` : ''
                  }`}
                </div>
              </div>
            </div>
            <button
              type="button"
              className={quietBtnCls}
              disabled={signingOut}
              aria-busy={signingOut || undefined}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await signOut();
                } finally {
                  setSigningOut(false);
                }
                // navigate() is a client-side transition, so without this the
                // signed-out person's name, alerts and contracts stay on screen
                // for the next person to sign in until each query refetches.
                queryClient.clear();
                navigate('/login');
              }}
            >
              <BusyLabel busy={signingOut} label={t('web.nav.logout', 'Log out')} busyLabel={t('web.nav.loggingOut', 'Logging out…')} />
            </button>
          </div>
        </div>
      </header>

      {role === 'buyer' && pathname.startsWith('/market') && (
        // Phones get the market search as its own row under the header.
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 md:hidden">
          <input
            type="search"
            enterKeyHint="search"
            aria-label={t('web.nav.search', 'Search crops and regions')}
            className="h-11 w-full rounded-full border border-[var(--field-border)] bg-[var(--paper-lift)] px-4 text-base text-[var(--ink)] transition-[border-color] hover:border-[var(--ink-7)] focus:border-[var(--forest)]"
            placeholder="Search crops, regions…"
            value={searchParams.get('q') ?? ''}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {offlineSince !== null && (
        // Kept on screen, not an error wall: what is shown is still true, just not new.
        <p role="status" className="sticky top-16 z-10 mx-auto mt-2 flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-lift)] shadow-md lg:top-[76px]">
          <span aria-hidden className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-[var(--gold-bright)]" />
          {t('web.nav.offline', 'Offline. Showing what you saw at {time}.', {
            time: new Date(offlineSince).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          })}
        </p>
      )}

      <main id="main" tabIndex={-1} className="vt-page mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--ink-1)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {role === 'buyer' && lotCount !== null && (
              <span className="smallcaps flex items-center gap-1.5 text-[var(--ink-6)]">
                <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {lotCount} lot{lotCount === 1 ? '' : 's'} live
              </span>
            )}
            {live && (
              <span className="smallcaps flex items-center gap-1.5 text-[var(--ink-6)]" title="This screen updates as things happen">
                <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--forest)]" />
                Live
              </span>
            )}
            <span className="text-xs text-[var(--ink-6)]">Prototype · all payments are simulated</span>
          </div>
          <LangLegend />
        </div>
      </footer>

      {tabBar && (
        <nav
          aria-label={t('web.nav.main', 'Main')}
          className={`vt-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-[var(--ink-2)] bg-[var(--paper-lift)]/95 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-8px_24px_-20px_rgba(40,30,15,0.45)] backdrop-blur-md lg:hidden ${
            typing ? 'hidden' : ''
          }`}
        >
          <ul className="mx-auto flex max-w-lg">
            {sections.map((s) => (
              <li key={s.to} className="flex-1">
                <NavLink
                  to={s.to}
                  viewTransition
                  className={({ isActive }) =>
                    `flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-[12px] font-semibold leading-tight transition-colors active:bg-[var(--paper-deep)] ${
                      isActive ? 'text-[var(--forest-night)]' : 'text-[var(--ink-6)]'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={`flex h-8 w-14 items-center justify-center rounded-full transition-[background-color] duration-[var(--dur-base)] ${
                          isActive ? 'bg-[var(--forest-wash)]' : ''
                        }`}
                      >
                        <Glyph name={s.icon} className="h-6 w-6" />
                      </span>
                      {s.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

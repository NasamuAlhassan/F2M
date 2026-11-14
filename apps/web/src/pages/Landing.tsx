import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LocaleInfo } from '../api';
import { F2MSeal } from '../components/engrave';
import { SkipLink } from '../components/SkipLink';
import { iconBtnCls, quietBtnCls, textLinkCls } from '../components/ui';
import { useT } from '../lib/i18n';
import { HOME_FOR, useAccount } from '../lib/session';
import { useScrolled } from '../lib/useScrolled';

type T = ReturnType<typeof useT>['t'];

/**
 * The public front door (D-048). It explains F2M through one ordinary sale,
 * told step by step with real places, instead of slogans.
 *
 * Every claim is one the prototype can back today: USSD and voice listing,
 * bids, SMS and voice-call offers, held payment, driver pickup, grading at
 * pickup, mobile money payout, simulated payments. The named farmer in the
 * walkthrough is an example and is labelled as one. No figures, no
 * testimonials, no partner logos.
 *
 * Deliberately plain: one italic accent on the page (the hero), no
 * scroll-triggered fades, no ticker, no feature-card grid.
 */

const sections = (t: T) => [
  { id: 'how', label: t('web.landing.navHow', 'How a sale works') },
  { id: 'who', label: t('web.landing.navWho', 'Who it is for') },
  { id: 'languages', label: t('web.landing.navLanguages', 'Languages') },
];

const pill =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-[background-color,scale] active:scale-[0.97]';
const pillPrimary = `${pill} bg-[var(--forest)] text-[var(--paper-lift)] shadow-sm hover:bg-[var(--forest-deep)] active:bg-[var(--forest-deep)]`;
const pillGhost = `${pill} border border-[var(--ink-4)] text-[var(--ink)] hover:bg-[var(--paper-deep)] active:bg-[var(--paper-deep)]`;
// A text link standing on its own line: underlined, 44px tall.
const soloLink = `${textLinkCls} inline-flex min-h-11 items-center text-[15px] font-semibold`;

function Header() {
  const { t } = useT();
  const scrolled = useScrolled();
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  return (
    <header
      className={`sticky top-0 z-30 border-b bg-[var(--paper)]/85 backdrop-blur-md transition-[border-color,box-shadow] duration-[var(--dur-base)] ${
        scrolled
          ? 'border-[var(--ink-1)] shadow-[0_1px_0_rgba(40,30,15,0.03),0_8px_24px_-18px_rgba(40,30,15,0.35)]'
          : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex h-[76px] max-w-[1200px] items-center gap-4 px-5 sm:px-8">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2.5 rounded-full transition-opacity hover:opacity-85 active:opacity-70"
          aria-label={t('web.landing.home', 'Farm to Market, home')}
        >
          <F2MSeal className="h-10 w-10" />
          <span className="whitespace-nowrap text-base font-extrabold uppercase tracking-[0.04em] text-[var(--forest-deep)] sm:text-lg">
            Farm to Market
          </span>
        </Link>

        <nav aria-label={t('web.landing.sections', 'Sections')} className="mx-auto hidden items-center gap-1 lg:flex">
          {sections(t).map((s) => (
            <a key={s.id} href={`#${s.id}`} className={quietBtnCls}>
              {s.label}
            </a>
          ))}
          <Link to="/phone" className={quietBtnCls}>
            {t('web.landing.tryPhone', 'Try the phone menu')}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {account ? (
            <Link to={HOME_FOR[account.role]} className={`${pillPrimary} min-h-11 px-5 text-sm`}>
              {t('web.landing.openDesk', 'Open your desk')}
            </Link>
          ) : (
            <>
              <Link to="/login" className={`${quietBtnCls} max-sm:hidden`}>
                {t('web.landing.signIn', 'Sign in')}
              </Link>
              <Link to="/login?mode=signup" className={`${pillPrimary} min-h-11 px-5 text-sm max-sm:hidden`}>
                {t('web.landing.createAccount', 'Create an account')}
              </Link>
            </>
          )}
          <button
            type="button"
            className={`${iconBtnCls} text-[var(--ink)] lg:hidden`}
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={open ? t('web.landing.closeMenu', 'Close menu') : t('web.landing.openMenu', 'Open menu')}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden className="flex w-5 flex-col gap-[5px]">
              <span className={`h-[2px] rounded bg-current transition-[translate,rotate] duration-[var(--dur-base)] ${open ? 'translate-y-[7px] rotate-45' : ''}`} />
              <span className={`h-[2px] rounded bg-current transition-opacity duration-[var(--dur-base)] ${open ? 'opacity-0' : ''}`} />
              <span className={`h-[2px] rounded bg-current transition-[translate,rotate] duration-[var(--dur-base)] ${open ? '-translate-y-[7px] -rotate-45' : ''}`} />
            </span>
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="landing-menu"
          aria-label={t('web.landing.sections', 'Sections')}
          className="border-t border-[var(--ink-1)] px-5 pb-5 pt-2 lg:hidden"
        >
          {sections(t).map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setOpen(false)}
              className="block border-b border-[var(--ink-1)] py-3.5 text-base font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]/60 active:bg-[var(--paper-deep)]"
            >
              {s.label}
            </a>
          ))}
          <Link to="/phone" className="block border-b border-[var(--ink-1)] py-3.5 text-base font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]/60 active:bg-[var(--paper-deep)]">
            {t('web.landing.tryPhone', 'Try the phone menu')}
          </Link>
          {!account && (
            <div className="flex gap-3 pt-4">
              <Link to="/login?mode=signup" className={`${pillPrimary} flex-1`}>
                {t('web.landing.createAccount', 'Create an account')}
              </Link>
              <Link to="/login" className={`${pillGhost} flex-1`}>
                {t('web.landing.signIn', 'Sign in')}
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

/** A basic-phone screen showing the real USSD home menu (catalog keys ussd.home.*). */
function UssdCard() {
  const { t } = useT();
  return (
    <figure className="w-[230px] rounded-[30px] bg-[var(--forest-night)] p-3 shadow-[0_30px_60px_-25px_rgba(12,61,36,0.6)]">
      <div className="rounded-[18px] bg-[#c9d6a4] px-4 py-3.5 font-mono text-[13px] leading-[1.6] text-[#1a2005]">
        <div className="mb-1.5 flex justify-between text-[11px]">
          <span>*384*7247#</span>
          <span aria-hidden>▮▮▮</span>
        </div>
        <div className="font-bold">Farm to Market</div>
        <div>{t('web.landing.ussd1', '1. Sell produce')}</div>
        <div>{t('web.landing.ussd2', '2. My offers')}</div>
        <div>{t('web.landing.ussd3', '3. My lots')}</div>
        <div>{t('web.landing.ussd4', '4. Payments')}</div>
        <div>{t('web.landing.ussd5', '5. Market prices')}</div>
      </div>
      <figcaption className="sr-only">{t('web.landing.ussdCaption', 'The menu a farmer sees after dialling *384*7247#')}</figcaption>
    </figure>
  );
}

function Hero() {
  const { t } = useT();
  return (
    <section className="mx-auto grid max-w-[1200px] items-center gap-14 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
      <div>
        <h1 className="headline text-[42px] text-[var(--ink)] sm:text-6xl">
          {t('web.landing.heroTitle', 'Sell your harvest from')} <em>{t('web.landing.heroTitleEm', 'any phone')}</em>
          {t('web.landing.heroTitleEnd', ', in your own language.')}
        </h1>
        <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[var(--ink-7)]">
          {t(
            'web.landing.heroBody',
            'Dial *384*7247#, or call and say what you have. Buyers across Ghana see your listing and make you an offer. When you accept, a driver on your road collects it.',
          )}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link to="/login?mode=signup" className={pillPrimary}>
            {t('web.landing.createAccount', 'Create an account')}
          </Link>
          <Link to="/phone" className={`${soloLink} text-[var(--forest-deep)]`}>
            {t('web.landing.heroTry', 'Try the phone menu in your browser')}
          </Link>
        </div>
        <p className="mt-10 max-w-md border-t border-[var(--ink-2)] pt-4 text-sm leading-relaxed text-[var(--ink-6)]">
          {t(
            'web.landing.heroBuyers',
            'Buying for a shop, a school kitchen or a processor? Create a buyer account to see what farmers have listed.',
          )}
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-[520px]">
        <div className="aspect-[4/5] overflow-hidden rounded-[28px] shadow-[0_40px_80px_-40px_rgba(40,30,15,0.55)]">
          <img
            src="/images/marketing/market-hero.jpg"
            alt={t('web.landing.heroAlt', 'Tomatoes, carrots, peppers and potatoes piled together')}
            className="h-full w-full object-cover"
            width={1600}
            height={1000}
          />
        </div>
        <div className="absolute -bottom-10 left-4 sm:-left-8">
          <UssdCard />
        </div>
      </div>
    </section>
  );
}

/** One sale, told as it happens. The farmer is an example, and says so. */
function HowASaleWorks() {
  const { t } = useT();
  const steps = [
    t(
      'web.landing.step1',
      'Ama grows maize near Garu. After harvest she dials *384*7247#, picks "Sell produce" and enters 10 bags, grade B.',
    ),
    t('web.landing.step2', 'Her listing is on the marketplace straight away, with her district and the quantity left.'),
    t(
      'web.landing.step3',
      'A buyer in Kumasi places a bid. Ama gets an SMS and a voice call in Kusaal, and accepts from the same phone.',
    ),
    t(
      'web.landing.step4',
      "The buyer's money is held. A driver already working the Bawku road collects the bags, and they are graded at pickup.",
    ),
    t('web.landing.step5', 'Ama is paid to her mobile money number.'),
  ];
  return (
    <section id="how" className="scroll-mt-24 border-t border-[var(--ink-1)]">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
        <div>
          <h2 className="headline text-4xl text-[var(--ink)] sm:text-5xl">{t('web.landing.howTitle', 'How a sale works')}</h2>
          <p className="mt-5 max-w-sm text-[16px] leading-relaxed text-[var(--ink-7)]">
            {t(
              'web.landing.howIntro',
              'Here is one sale from start to finish. Ama is an example, but every step is what the app does today.',
            )}
          </p>
        </div>
        <ol className="space-y-0">
          {steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-4 border-t border-[var(--ink-2)] py-5 first:border-t-0 first:pt-0">
              <span className="serial text-lg text-[var(--gold-ink)]">{String(i + 1).padStart(2, '0')}</span>
              <p className="text-[17px] leading-relaxed text-[var(--ink)]">{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function WhoItIsFor() {
  const { t } = useT();
  const rows = [
    {
      who: t('web.landing.whoFarmers', 'Farmers'),
      text: t(
        'web.landing.whoFarmersText',
        'List from a basic phone by menu or by voice. Offers come to you by SMS and a phone call, so you do not need data or a smartphone.',
      ),
      cta: t('web.landing.whoFarmersCta', 'Create a farmer account'),
    },
    {
      who: t('web.landing.whoBuyers', 'Buyers'),
      text: t(
        'web.landing.whoBuyersText',
        'See what is for sale up north before you travel, bid on a lot, or post what you need and get matched as new lots come in.',
      ),
      cta: t('web.landing.whoBuyersCta', 'Create a buyer account'),
    },
    {
      who: t('web.landing.whoDrivers', 'Drivers'),
      text: t('web.landing.whoDriversText', 'Tell us your routes and your vehicle. Loads that fit come to you first.'),
      cta: t('web.landing.whoDriversCta', 'Create a driver account'),
    },
  ];
  return (
    <section id="who" className="scroll-mt-24 bg-[var(--paper-deep)]/60">
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 lg:py-24">
        <h2 className="headline text-4xl text-[var(--ink)] sm:text-5xl">{t('web.landing.whoTitle', 'Who it is for')}</h2>
        <div className="mt-10 divide-y divide-[var(--ink-2)] border-y border-[var(--ink-2)]">
          {rows.map((r) => (
            <div key={r.who} className="grid gap-3 py-7 md:grid-cols-[12rem_1fr_auto] md:items-baseline md:gap-8">
              <h3 className="headline text-2xl text-[var(--ink)]">{r.who}</h3>
              <p className="max-w-xl text-[16px] leading-relaxed text-[var(--ink-7)]">{r.text}</p>
              <Link to="/login?mode=signup" className={`${soloLink} justify-self-start text-[var(--forest-deep)]`}>
                {r.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Why() {
  const { t } = useT();
  return (
    <section className="plate">
      <div className="mx-auto max-w-[900px] px-5 py-20 sm:px-8 lg:py-28">
        <h2 className="headline text-3xl sm:text-4xl">{t('web.landing.whyTitle', 'Why we are building this')}</h2>
        <p className="mt-6 text-[19px] leading-relaxed text-[var(--ink-2)] sm:text-xl">
          {t(
            'web.landing.why1',
            "Most harvests in the Upper East are sold at the farm gate, to the first trader who arrives, at the trader's price. Buyers in Kumasi and Accra would often pay more, but they cannot see what is for sale up north.",
          )}
        </p>
        <p className="mt-5 text-[19px] leading-relaxed text-[var(--ink-2)] sm:text-xl">
          {t(
            'web.landing.why2',
            'F2M lets them see it. It is an early prototype: we are testing it with a small group of farmers, buyers and drivers, and payments are simulated for now.',
          )}
        </p>
      </div>
    </section>
  );
}

function Languages() {
  const { t } = useT();
  const { data } = useQuery({
    queryKey: ['locales'],
    queryFn: () => api<{ locales: LocaleInfo[] }>('/api/i18n/locales'),
    staleTime: 60_000,
  });
  const locales = data?.locales ?? [];
  return (
    <section id="languages" className="scroll-mt-24">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
        <div>
          <h2 className="headline text-4xl text-[var(--ink)] sm:text-5xl">{t('web.landing.langTitle', 'Use it in your language')}</h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[var(--ink-7)]">
            {t(
              'web.landing.langBody',
              'Menus, messages and voice calls work in the languages of the farmers who use F2M. The translations are made by machine for now, and native speakers are checking them line by line.',
            )}
          </p>
        </div>
        <ul className="flex flex-wrap content-center gap-3">
          {locales.map((l) => (
            <li
              key={l.code}
              className={`inline-flex items-baseline gap-2 rounded-full border bg-[var(--paper-lift)] px-5 py-3 ${
                l.live ? 'border-[var(--forest)] text-[var(--ink)]' : 'border-[var(--ink-2)] text-[var(--ink-7)]'
              }`}
            >
              <span className="headline text-2xl" lang={l.code}>
                {l.endonym}
              </span>
              {/* English is the source language: nothing to check, so no badge. */}
              {l.code !== 'en' && (
                <span className="text-xs font-semibold text-[var(--ink-6)]">
                  {l.reviewed
                    ? t('web.landing.langChecked', 'Checked')
                    : l.live
                      ? t('web.landing.langLive', 'Live, being checked')
                      : t('web.landing.langSoon', 'Coming soon')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useT();
  const { account } = useAccount();
  return (
    <footer className="plate">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-6 border-b border-white/15 py-14 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <F2MSeal className="h-10 w-10" dark />
            <span className="text-lg font-extrabold uppercase tracking-[0.04em]">Farm to Market</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              to={account ? HOME_FOR[account.role] : '/login?mode=signup'}
              className={`${pill} bg-[var(--gold-bright)] text-[var(--forest-night)] hover:bg-[var(--paper-lift)] active:bg-[var(--paper-lift)]`}
            >
              {account ? t('web.landing.openDesk', 'Open your desk') : t('web.landing.createAccount', 'Create an account')}
            </Link>
            {!account && (
              <Link to="/login" className={`${soloLink} text-[var(--paper-lift)]`}>
                {t('web.landing.signIn', 'Sign in')}
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-8 py-10 text-[15px] sm:flex-row sm:justify-between">
          <ul className="flex flex-wrap gap-x-6">
            {sections(t).map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="inline-flex min-h-11 items-center text-[var(--ink-2)] underline decoration-transparent underline-offset-[0.2em] transition-[color,text-decoration-color,opacity] hover:text-[var(--paper-lift)] hover:decoration-current active:opacity-70">
                  {s.label}
                </a>
              </li>
            ))}
            <li>
              <Link to="/phone" className="inline-flex min-h-11 items-center text-[var(--ink-2)] underline decoration-transparent underline-offset-[0.2em] transition-[color,text-decoration-color,opacity] hover:text-[var(--paper-lift)] hover:decoration-current active:opacity-70">
                {t('web.landing.tryPhone', 'Try the phone menu')}
              </Link>
            </li>
          </ul>
          <p className="max-w-sm text-sm text-[var(--ink-3)]">
            {t('web.landing.prototype', 'Prototype. Payments are simulated and no real money moves.')} ©{' '}
            {new Date().getFullYear()} Farm to Market
          </p>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  const { t } = useT();
  useEffect(() => {
    document.title = `Farm to Market · ${t('web.landing.tabTitle', 'Sell your harvest from any phone')}`;
  }, [t]);
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SkipLink />
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero />
        <HowASaleWorks />
        <WhoItIsFor />
        <Why />
        <Languages />
      </main>
      <Footer />
    </div>
  );
}

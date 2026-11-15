import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, dateTime, ghs } from '../api';
import { CropMark, Glyph } from '../components/engrave';
import { Modal } from '../components/Modal';
import {
  affixInputCls,
  affixTextCls,
  affixWrapCls,
  backLinkCls,
  btnCls,
  btnGhostCls,
  BusyLabel,
  ErrorStamp,
  FieldSet,
  FormField,
  fieldAria,
  fieldCls,
  GradeBadge,
  LoadGate,
  plateBtnCls,
  RadioCard,
  StateBadge,
  toast,
} from '../components/ui';
import { haptic } from '../lib/haptics';
import { DEAL_PATH, deadline, firstName, LANGUAGE_NAME, type ClaimReason, type DealActor, type DealEvent, type DealRole, type DealView } from '../lib/deal';
import { useT } from '../lib/i18n';

type T = ReturnType<typeof useT>['t'];

/**
 * One sale, the same page for the buyer, the farmer and the driver: whose turn
 * it is, where the money is, and every step so far and still to come. The
 * same events reach a farmer on a basic phone by SMS and voice.
 */
export function DealPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const sample = import.meta.env.DEV ? params.get('sample') : null;
  const { t } = useT();

  const query = useQuery({
    queryKey: ['deal', id, sample],
    queryFn: async (): Promise<DealView> => {
      if (sample) {
        const { DEAL_SAMPLES } = await import('../lib/dealFixtures');
        const found = DEAL_SAMPLES[sample];
        if (!found) throw new Error(`No sample called "${sample}". Try: ${Object.keys(DEAL_SAMPLES).join(', ')}.`);
        return found;
      }
      return api<DealView>(`/api/deals/${id}`);
    },
    refetchInterval: sample ? false : 15_000,
  });

  useEffect(() => {
    if (!query.data) return;
    const d = query.data.deal;
    document.title = `${d.quantityKg} kg ${d.crop.name.toLowerCase()} · Farm to Market`;
  }, [query.data]);

  if (!query.data) {
    return <LoadGate isError={query.isError} retrying={query.isFetching} onRetry={() => void query.refetch()} label={t('web.deal.loadLabel', 'this sale')} />;
  }
  return <DealBody view={query.data} sample={Boolean(sample)} />;
}

function DealBody({ view, sample }: { view: DealView; sample: boolean }) {
  const { t } = useT();
  const { deal, people, viewer } = view;
  const back =
    viewer === 'buyer'
      ? { to: '/contracts', label: t('web.deal.backBuyer', 'All purchases') }
      : viewer === 'farmer'
        ? { to: '/farmer/dashboard', label: t('web.deal.backFarmer', 'Seller desk') }
        : { to: '/driver/jobs', label: t('web.deal.backDriver', 'Dispatch board') };
  const buyerName = people.buyer.company ?? people.buyer.name;
  const from = [firstName(people.farmer.name), people.farmer.district].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={back.to} viewTransition className={backLinkCls}>
        ← {back.label}
      </Link>

      <header className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="hatch flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl">
          <CropMark code={deal.crop.code} className="h-8 w-8 text-[var(--forest)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
            {t('web.deal.title', '{kg} kg {crop}', { kg: deal.quantityKg.toLocaleString(), crop: deal.crop.name.toLowerCase() })}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">
            {t('web.deal.fromTo', 'From {from} to {to}', { from, to: buyerName })}
            <span className="serial ml-2 whitespace-nowrap text-xs">{deal.lotCode}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StateBadge state={deal.state} />
            {deal.finalGrade && <GradeBadge grade={deal.finalGrade} />}
            {viewer === 'buyer' && (
              <Link to={`/contracts/${deal.id}`} className="ml-1 text-xs font-semibold text-[var(--gold-deep)] underline decoration-[var(--gold-deep)]/40 underline-offset-4 hover:decoration-[var(--gold-deep)]">
                {t('web.deal.fullContract', 'Payments, grading and QR code')}
              </Link>
            )}
          </div>
        </div>
      </header>

      {sample && (
        <p className="mt-3 rounded-2xl bg-[var(--gold-wash)] px-3 py-2 text-xs text-[var(--ink-7)]">
          {t('web.deal.sampleNote', 'Sample data for design. Buttons here do not send anything.')}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-1 lg:row-start-1">
          <NextStep view={view} sample={sample} />
        </div>
        <div className="lg:col-start-2 lg:row-start-1">
          <MoneyCard view={view} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <Timeline view={view} />
        </div>
        <div className="self-start lg:col-start-2 lg:row-start-2">
          <PeopleCard view={view} />
        </div>
      </div>
    </div>
  );
}

/* ── Who is who, from where the viewer stands ─────────────────────────── */

function useNames(view: DealView) {
  const { t } = useT();
  const { people, viewer } = view;
  const name = (role: DealActor): string => {
    if (role === viewer) return t('web.deal.you', 'You');
    if (role === 'buyer') return people.buyer.company ?? firstName(people.buyer.name);
    if (role === 'farmer') return firstName(people.farmer.name);
    if (role === 'driver') return people.driver ? firstName(people.driver.name) : t('web.deal.theDriver', 'The driver');
    if (role === 'f2m') return 'F2M';
    return '';
  };
  return { name, isYou: (role: DealActor) => role === viewer };
}

/** Re-renders once a minute, so "in 18 hours" counts down while the page is open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The driver's next tap, from the server's broader step and what is done already. */
function driverStep(view: DealView): string | null {
  const next = view.next;
  if (!next || next.actor !== 'driver') return null;
  const done = new Set(view.timeline.map((e) => e.kind));
  if (next.action === 'go_to_pickup') return done.has('at_pickup') ? 'loaded' : 'at_pickup';
  if (next.action === 'deliver') return done.has('departed') ? 'arrived' : 'departed';
  return null;
}

/* ── The next step: whose turn it is, and the buttons when it is yours ── */

function NextStep({ view, sample }: { view: DealView; sample: boolean }) {
  const { t } = useT();
  const { name } = useNames(view);
  const { next, viewer, deal, money, claims, people } = view;
  const [sheet, setSheet] = useState<null | 'receive' | 'report' | 'accept' | 'refuse'>(null);
  const [done, setDone] = useState<null | { title: string; body: string }>(null);
  const act = useDealAction(view, sample);
  const now = useMinuteClock();
  const finish = (title: string, body: string) => {
    setSheet(null);
    setDone({ title, body });
    haptic('success');
  };

  if (!next) {
    const done = ['SETTLED', 'CANCELLED', 'CANCELLED_REFUNDED'].includes(deal.state);
    return (
      <section className="certificate bg-[var(--paper-lift)] p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
          <Glyph name="check" className="h-5 w-5 text-[var(--success)]" />
          {done && deal.state === 'SETTLED'
            ? t('web.deal.doneTitle', 'Sale complete. Everyone has been paid.')
            : t('web.deal.closedTitle', 'This sale is closed.')}
        </p>
      </section>
    );
  }

  const due = next.dueAt ? deadline(next.dueAt, now) : null;
  const claim = next.ref ? claims.find((c) => c.id === next.ref) : claims.find((c) => c.status === 'awaiting_farmer');
  const crop = deal.crop.name.toLowerCase();

  // Someone else's move: say whose, and by when.
  if (next.actor !== viewer) {
    const waitingFor = WAITING_TEXT(t, next.action, name(next.actor), people.farmer.name, people.buyer.company ?? firstName(people.buyer.name));
    return (
      <section className="certificate bg-[var(--paper-lift)] p-5">
        <p className="smallcaps text-[var(--ink-6)]">
          {next.actor === 'system' || next.actor === 'f2m' ? t('web.deal.f2mLabel', 'F2M is on it') : t('web.deal.waitingLabel', 'Waiting')}
        </p>
        <p className="mt-1.5 flex items-start gap-2.5 text-[17px] font-semibold leading-snug text-[var(--ink)]">
          <span aria-hidden className="ember mt-2 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-[var(--gold)]" />
          {waitingFor}
        </p>
        {due && (
          <p className={`mt-1.5 pl-[18px] text-sm ${due.soon || due.past ? 'font-semibold text-[var(--stamp-deep)]' : 'text-[var(--ink-6)]'}`}>
            {t('web.deal.dueLine', 'By {when} · {left}', { when: due.when, left: due.left })}
          </p>
        )}
        {next.action === 'confirm_receipt' && due && (
          <p className="mt-1 pl-[18px] text-sm text-[var(--ink-6)]">
            {viewer === 'farmer'
              ? t('web.deal.autoConfirmFarmer', 'If they do nothing, it confirms itself at {when} and your balance is sent.', { when: due.when })
              : t('web.deal.autoConfirm', 'If nobody answers, it confirms itself at {when}.', { when: due.when })}
          </p>
        )}
      </section>
    );
  }

  // The viewer's move.
  let title: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  if (next.action === 'confirm_receipt' && money) {
    title = t('web.deal.arrivedTitle', 'Your {crop} has arrived', { crop });
    body = t(
      'web.deal.arrivedBody',
      'Check it, then confirm. If something is wrong, report it. Confirming sends {farmer} the balance of {amount}.',
      { farmer: firstName(people.farmer.name), amount: ghs(money.stillHeld) },
    );
    actions = (
      <>
        <button type="button" className={plateMainCls} onClick={() => setSheet('receive')}>
          {t('web.deal.confirmBtn', 'Confirm it arrived')}
        </button>
        <button type="button" className={plateSecondCls} onClick={() => setSheet('report')}>
          {t('web.deal.reportBtn', 'Report a problem')}
        </button>
      </>
    );
  } else if (next.action === 'answer_claim' && claim) {
    title = t('web.deal.claimTitle', '{buyer} reports a problem', { buyer: name('buyer') });
    body = (
      <>
        {t('web.deal.claimBody', '{reason}. They ask for {amount} off.', {
          reason: REASON_LABEL(t, claim.reason),
          amount: ghs(claim.proposedDeduction),
        })}
        {claim.note && <span className="mt-2 block border-l-2 border-[var(--gold-bright)] pl-3 italic">“{claim.note}”</span>}
      </>
    );
    actions = (
      <>
        <button type="button" className={plateMainCls} onClick={() => setSheet('accept')}>
          {t('web.deal.acceptClaimBtn', 'Accept {amount} off', { amount: ghs(claim.proposedDeduction) })}
        </button>
        <button type="button" className={plateSecondCls} onClick={() => setSheet('refuse')}>
          {t('web.deal.refuseClaimBtn', 'Refuse')}
        </button>
      </>
    );
  } else if (driverStep(view) && DRIVER_STEPS[driverStep(view)!]) {
    const sub = driverStep(view)!;
    const step = DRIVER_STEPS[sub]!;
    title = step.title(t, people, crop);
    body = step.body(t, people);
    actions = (
      <button
        type="button"
        className={plateMainCls}
        disabled={act.isPending}
        aria-busy={act.isPending || undefined}
        onClick={() => act.mutate({ kind: 'driver', step: sub })}
      >
        <BusyLabel busy={act.isPending} label={step.button(t)} />
      </button>
    );
  } else if (OLDER_PAGE_STEPS[next.action]) {
    const step = OLDER_PAGE_STEPS[next.action]!;
    title = step.title(t, deal.finalGrade);
    body = step.body(t);
    actions = (
      <Link to={viewer === 'farmer' ? '/farmer/dashboard' : `/contracts/${deal.id}`} className={plateMainCls}>
        {step.button(t)}
      </Link>
    );
  } else if (next.action === 'answer_offer') {
    title = t('web.deal.offerTitle', '{buyer} made you an offer', { buyer: name('buyer') });
    body = t('web.deal.offerBody', 'Answer it on your desk, or by phone.');
    actions = (
      <Link to="/farmer/dashboard" className={plateMainCls}>
        {t('web.deal.offerBtn', 'Open my offers')}
      </Link>
    );
  }

  return (
    <section className="certificate plate on-dark overflow-hidden p-5 sm:p-6" aria-labelledby="next-step-title">
      <p className="smallcaps text-[var(--gold-bright)]">{t('web.deal.yourTurn', 'Your next step')}</p>
      <h2 id="next-step-title" className="headline mt-1.5 text-2xl sm:text-3xl">
        {title}
      </h2>
      {body && <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{body}</p>}
      {due && (
        <p
          className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
            due.soon || due.past ? 'bg-[var(--stamp)] text-[var(--paper-lift)]' : 'bg-[var(--paper-lift)]/10 text-[var(--gold-bright)]'
          }`}
        >
          <Glyph name="clock" className="h-4 w-4" />
          {t('web.deal.answerBy', 'By {when} · {left}', { when: due.when, left: due.left })}
        </p>
      )}
      {next.action === 'confirm_receipt' && due && money && (
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          {t('web.deal.autoConfirmYou', 'If you do nothing, it confirms itself at {when} and {farmer} is paid.', {
            when: due.when,
            farmer: firstName(people.farmer.name),
          })}
        </p>
      )}
      {act.error && (
        <ErrorStamp message={act.error instanceof Error ? act.error.message : String(act.error)} onDismiss={() => act.reset()} className="mt-3" />
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">{actions}</div>

      {sheet === 'receive' && money && (
        <ConfirmSheet
          title={t('web.deal.receiveTitle', 'Confirm the {crop} arrived?', { crop })}
          body={t(
            'web.deal.receiveBody',
            'The balance of {amount} goes to {farmer}, and the driver is paid. You cannot report a problem after this.',
            { amount: ghs(money.stillHeld), farmer: firstName(people.farmer.name) },
          )}
          confirm={t('web.deal.receiveConfirm', 'Yes, it arrived')}
          busy={act.isPending}
          onConfirm={() =>
            act.mutate(
              { kind: 'receive' },
              {
                onSuccess: () =>
                  finish(
                    t('web.deal.doneReceived', 'Confirmed. Thank you.'),
                    t('web.deal.doneReceivedBody', '{farmer} is being paid the balance of {amount}, and the driver their fee. You will find the receipt under Payments.', {
                      farmer: firstName(people.farmer.name),
                      amount: ghs(money.stillHeld),
                    }),
                  ),
              },
            )
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'report' && money && (
        <ReportSheet
          view={view}
          busy={act.isPending}
          onClose={() => setSheet(null)}
          onSend={(c) =>
            act.mutate(
              { kind: 'claim', ...c },
              {
                onSuccess: () =>
                  finish(
                    t('web.deal.doneClaim', 'Your report is sent'),
                    t('web.deal.doneClaimBody', '{farmer} is called and asked to accept or refuse {amount} off. The rest of the money stays held until then.', {
                      farmer: firstName(people.farmer.name),
                      amount: ghs(c.deduction),
                    }),
                  ),
              },
            )
          }
        />
      )}
      {(sheet === 'accept' || sheet === 'refuse') && claim && (
        <ConfirmSheet
          title={
            sheet === 'accept'
              ? t('web.deal.acceptTitle', 'Accept {amount} off?', { amount: ghs(claim.proposedDeduction) })
              : t('web.deal.refuseTitle', 'Refuse the deduction?')
          }
          body={
            sheet === 'accept'
              ? t('web.deal.acceptBody', 'Your balance becomes {left}. It is sent to your mobile money straight away.', {
                  left: ghs(Math.max(0, (money?.stillHeld ?? 0) - claim.proposedDeduction)),
                })
              : t(
                  'web.deal.refuseBody',
                  'F2M will look at the photos from pickup and what both of you said, then decide. Your balance waits until then.',
                )
          }
          confirm={sheet === 'accept' ? t('web.deal.acceptConfirm', 'Accept') : t('web.deal.refuseConfirm', 'Refuse')}
          busy={act.isPending}
          onConfirm={() =>
            act.mutate(
              { kind: 'answer', claimId: claim.id, accept: sheet === 'accept' },
              {
                onSuccess: (_d, a) =>
                  a.kind === 'answer' && a.accept
                    ? finish(
                        t('web.deal.doneAccepted', 'Accepted'),
                        t('web.deal.doneAcceptedBody', 'Your balance of {left} is on its way to your mobile money.', {
                          left: ghs(Math.max(0, (money?.stillHeld ?? 0) - claim.proposedDeduction)),
                        }),
                      )
                    : finish(
                        t('web.deal.doneRefused', 'Refused'),
                        t('web.deal.doneRefusedBody', 'F2M will look at the photos from pickup and what both of you said, then decide. We will text you.'),
                      ),
              },
            )
          }
          onClose={() => setSheet(null)}
        />
      )}
      {done && <SuccessSheet title={done.title} body={done.body} reference={deal.lotCode} onClose={() => setDone(null)} />}
    </section>
  );
}

// Buttons on the dark field: one light, one outlined.
const plateMainCls =
  'inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--paper-lift)] px-6 text-[15px] font-semibold text-[var(--forest-night)] shadow-sm transition-[background-color,scale] hover:bg-white active:scale-[0.97] disabled:opacity-60 sm:min-h-11';
const plateSecondCls =
  'inline-flex min-h-12 items-center justify-center rounded-full px-6 text-[15px] font-semibold text-[var(--paper-lift)] ring-1 ring-[var(--paper-lift)]/45 transition-[background-color,scale] hover:bg-[var(--paper-lift)]/10 active:scale-[0.97] sm:min-h-11';

const DRIVER_STEPS: Partial<
  Record<
    string,
    {
      title: (t: T, p: DealView['people'], crop: string) => string;
      body: (t: T, p: DealView['people']) => string;
      button: (t: T) => string;
    }
  >
> = {
  at_pickup: {
    title: (t, p) => t('web.deal.drvPickupTitle', 'Go to {farmer} in {place}', { farmer: firstName(p.farmer.name), place: p.farmer.district ?? p.farmer.region ?? '' }),
    body: (t) => t('web.deal.drvPickupBody', 'Tap when you reach the farm. The produce is graded from photos before you load.'),
    button: (t) => t('web.deal.drvPickupBtn', "I'm at the farm"),
  },
  loaded: {
    title: (t, _p, crop) => t('web.deal.drvLoadTitle', 'Load the {crop}', { crop }),
    body: (t) => t('web.deal.drvLoadBody', 'Count the bags as they go on. Tap when everything is loaded.'),
    button: (t) => t('web.deal.drvLoadBtn', 'Goods loaded'),
  },
  departed: {
    title: (t, p) => t('web.deal.drvDepartTitle', 'Set off for {buyer}', { buyer: p.buyer.company ?? firstName(p.buyer.name) }),
    body: (t) => t('web.deal.drvDepartBody', 'The buyer is told you are on the way.'),
    button: (t) => t('web.deal.drvDepartBtn', "I'm on the road"),
  },
  arrived: {
    title: (t, p) => t('web.deal.drvArriveTitle', 'Deliver to {buyer}', { buyer: p.buyer.company ?? firstName(p.buyer.name) }),
    body: (t) => t('web.deal.drvArriveBody', 'Tap when you arrive. You are paid when they confirm, or after 24 hours.'),
    button: (t) => t('web.deal.drvArriveBtn', "I've arrived"),
  },
};

/** Steps whose controls still live on the contract page or the seller desk. */
const OLDER_PAGE_STEPS: Partial<Record<string, { title: (t: T, grade: string | null) => string; body: (t: T) => string; button: (t: T) => string }>> = {
  secure_payment: {
    title: (t) => t('web.deal.payTitle', 'Hold the money for this sale'),
    body: (t) => t('web.deal.payBody', 'F2M holds it safely. Nobody can spend it until the produce is collected and graded.'),
    button: (t) => t('web.deal.openContract', 'Open the contract'),
  },
  arrange_pickup: {
    title: (t) => t('web.deal.pickupTitle', 'Arrange the pickup'),
    body: (t) => t('web.deal.pickupBody', 'Ask F2M to find a driver on this road, or collect it yourself.'),
    button: (t) => t('web.deal.openContract', 'Open the contract'),
  },
  retry_transport: {
    title: (t) => t('web.deal.retryTitle', 'No driver took the job yet'),
    body: (t) => t('web.deal.retryBody', 'Try again, or collect it yourself.'),
    button: (t) => t('web.deal.openContract', 'Open the contract'),
  },
  grade: {
    title: (t) => t('web.deal.gradeTitle', 'Grade the produce'),
    body: (t) => t('web.deal.gradeBody', 'Add the photos from pickup. The grade sets the final price.'),
    button: (t) => t('web.deal.openContract', 'Open the contract'),
  },
  regrade: {
    title: (t) => t('web.deal.regradeTitle', 'The farmer questioned the grade'),
    body: (t) => t('web.deal.regradeBody', 'Add clearer photos so the produce can be graded again.'),
    button: (t) => t('web.deal.openContract', 'Open the contract'),
  },
  review_grade: {
    title: (t, grade) => t('web.deal.reviewGradeTitle', 'Your produce was graded {grade}', { grade: grade ?? '' }),
    body: (t) => t('web.deal.reviewGradeBody', 'If you think the grade is wrong, you can question it before the time runs out.'),
    button: (t) => t('web.deal.openDesk', 'Open my desk'),
  },
};

function WAITING_TEXT(t: T, action: string, who: string, farmerName: string, buyerName: string): string {
  switch (action) {
    case 'secure_payment':
      return t('web.deal.waitPay', 'Waiting for {who} to hold the money', { who: buyerName });
    case 'arrange_pickup':
      return t('web.deal.waitArrange', 'Waiting for {who} to arrange the pickup', { who: buyerName });
    case 'retry_transport':
      return t('web.deal.waitRetry', 'No driver yet. Waiting for {who} to try again', { who: buyerName });
    case 'finding_driver':
      return t('web.deal.waitFinding', 'Finding a driver who works this road');
    case 'securing_transport':
      return t('web.deal.waitSecuring', "A driver took the job. Their fee is being held");
    case 'go_to_pickup':
      return t('web.deal.waitGoPickup', '{who} is on the way to the farm', { who });
    case 'grade':
    case 'regrade':
      return t('web.deal.waitGrade', 'Waiting for the produce to be graded');
    case 'review_grade':
      return t('web.deal.waitReviewGrade', '{who} can question the grade until the time runs out', { who: firstName(farmerName) });
    case 'deliver':
      return t('web.deal.waitDeliver', 'On the road to {buyer}', { buyer: buyerName });
    case 'paying_balance':
      return t('web.deal.waitPaying', 'The balance is being sent to {farmer}', { farmer: firstName(farmerName) });
    case 'confirm_receipt':
      return t('web.deal.waitReceipt', 'Waiting for {who} to confirm it arrived', { who });
    case 'answer_claim':
      return t('web.deal.waitClaim', 'Waiting for {who} to answer the problem report', { who });
    case 'review_claim':
      return t('web.deal.waitReview', 'F2M is looking at the problem report and will decide');
    case 'answer_offer':
      return t('web.deal.waitOffer', 'Waiting for {who} to answer your offer', { who: firstName(farmerName) });
    case 'at_pickup':
      return t('web.deal.waitPickup', '{who} is on the way to the farm', { who });
    case 'loaded':
      return t('web.deal.waitLoad', '{who} is loading the produce', { who });
    case 'departed':
      return t('web.deal.waitDepart', '{who} is about to set off', { who });
    case 'arrived':
      return t('web.deal.waitArrive', '{who} is on the road with your produce', { who });
    default:
      return t('web.deal.waitOther', 'Waiting for {who}', { who });
  }
}

/* ── Money: where every cedi is, in one bar ─────────────────────────────── */

function MoneyCard({ view }: { view: DealView }) {
  const { t } = useT();
  const { money, viewer, people } = view;

  if (!money) {
    // The driver sees their own fee, not the price of the produce.
    return (
      <section className="certificate bg-[var(--paper-lift)] p-5">
        <p className="smallcaps text-[var(--ink-6)]">{t('web.deal.yourFee', 'Your fee')}</p>
        <p className="serial mt-1 text-3xl font-bold text-[var(--gold-deep)]">{view.transport?.fee != null ? ghs(view.transport.fee) : '—'}</p>
        <p className="mt-1.5 text-sm text-[var(--ink-6)]">
          {view.timeline.some((e) => e.kind === 'driver_paid')
            ? t('web.deal.feePaid', 'Paid to your mobile money.')
            : t('web.deal.feeWhen', 'Held for you now. Paid when the buyer confirms it arrived, or after 24 hours.')}
        </p>
      </section>
    );
  }

  const farmer = firstName(people.farmer.name);
  const buyer = people.buyer.company ?? firstName(people.buyer.name);
  // Settled money reads solid; money on its way and money held say so, and
  // held money says what releases it. Held is never counted as paid.
  const parts = [
    {
      key: 'paid',
      amount: money.paidToFarmer,
      cls: 'bg-[var(--forest)]',
      icon: 'check',
      label: viewer === 'farmer' ? t('web.deal.mPaidYou', 'Paid to you') : t('web.deal.mPaid', 'Paid to {farmer}', { farmer }),
      note: null as string | null,
    },
    {
      key: 'way',
      amount: money.onTheWay,
      cls: 'bg-[var(--gold)]',
      icon: 'clock',
      label: viewer === 'farmer' ? t('web.deal.mWayYou', 'On its way to you') : t('web.deal.mWay', 'On its way to {farmer}', { farmer }),
      note: t('web.deal.mWayNote', 'Usually within minutes'),
    },
    {
      key: 'held',
      amount: money.stillHeld,
      cls: 'bg-[repeating-linear-gradient(135deg,var(--paper-deep)_0_6px,var(--ink-3)_6px_8px)]',
      icon: 'lock',
      label: viewer === 'farmer' ? t('web.deal.mHeldYou', 'Held for you by F2M') : t('web.deal.mHeld', 'Held by F2M'),
      note:
        viewer === 'farmer'
          ? t('web.deal.mHeldNoteFarmer', 'Sent to you when {buyer} confirms it arrived', { buyer })
          : t('web.deal.mHeldNote', 'Released to {farmer} when you confirm it arrived', { farmer }),
    },
    { key: 'off', amount: money.deduction, cls: 'bg-[var(--stamp)]', icon: 'cross', label: t('web.deal.mOff', 'Taken off for a problem'), note: null },
  ].filter((p) => p.amount > 0);

  return (
    <section className="certificate bg-[var(--paper-lift)] p-5" aria-labelledby="money-title">
      <p id="money-title" className="smallcaps text-[var(--ink-6)]">
        {t('web.deal.moneyTitle', 'The money')}
      </p>
      {viewer === 'farmer' ? (
        // What has reached her phone comes first; the total is the context.
        <>
          <Amount value={money.paidToFarmer} className="serial mt-1 block text-3xl font-bold text-[var(--forest)]" />
          <p className="text-xs text-[var(--ink-6)]">
            {t('web.deal.moneyFarmerSub', 'paid to your mobile money so far, of {total}', { total: ghs(money.total) })}
          </p>
        </>
      ) : (
        <>
          <p className="serial mt-1 text-3xl font-bold text-[var(--ink)]">{ghs(money.total)}</p>
          <p className="text-xs text-[var(--ink-6)]">
            {t('web.deal.moneySub', '{price}/kg · advance {advance} at pickup, the rest on arrival', {
              price: ghs(view.deal.pricePerKg ?? 0),
              advance: ghs(money.advance),
            })}
          </p>
        </>
      )}
      <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-[var(--paper-deep)]" aria-hidden>
        {parts.map((p) => (
          <span
            key={p.key}
            className={`${p.cls} h-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]`}
            style={{ width: `${(p.amount / Math.max(1, money.total)) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 divide-y divide-[var(--ink-1)]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-start gap-2">
              <span aria-hidden className={`mt-1 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${p.cls}`} />
              <span className="min-w-0">
                <span className={`flex items-center gap-1.5 ${p.key === 'paid' ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-7)]'}`}>
                  {p.label}
                  <Glyph name={p.icon} className="h-3.5 w-3.5 flex-shrink-0 text-[var(--ink-5)]" />
                </span>
                {p.note && <span className="mt-0.5 block text-xs leading-snug text-[var(--ink-6)]">{p.note}</span>}
              </span>
            </span>
            <Amount
              value={p.amount}
              className={`serial flex-shrink-0 ${p.key === 'paid' ? 'font-bold text-[var(--ink)]' : 'font-semibold text-[var(--ink-7)]'}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── The story so far, and the steps still ahead ───────────────────────── */

function Timeline({ view }: { view: DealView }) {
  const { t } = useT();
  const words = useEventWords(view);
  const { viewer } = view;

  // Notices (an SMS, a call) belong under the step that caused them.
  // Paired records (loaded + collected, arrived + delivered) show once, and a
  // run of pickup photos reads as one line.
  const kinds = new Set(view.timeline.map((e) => e.kind));
  const steps: Array<{ event: DealEvent; notices: DealEvent[]; photos: number }> = [];
  for (const e of [...view.timeline].sort((a, b) => a.at - b.at)) {
    // The server already keeps money and the haggle from the driver; this is a second guard.
    if (viewer === 'driver' && ((MONEY_KINDS.has(e.kind) && e.kind !== 'driver_paid') || DRIVER_HIDDEN.has(e.kind))) continue;
    if (e.kind === 'collected' && kinds.has('loaded')) continue;
    if (e.kind === 'delivered' && kinds.has('arrived')) continue;
    const prev = steps[steps.length - 1];
    if (e.kind === 'notice_sent' && prev) prev.notices.push(e);
    else if (e.kind === 'photo_added' && prev?.event.kind === 'photo_added') prev.photos += 1;
    else steps.push({ event: e, notices: [], photos: e.kind === 'photo_added' ? 1 : 0 });
  }
  // Steps present on first paint are the story so far; steps that arrive
  // while the page is open draw in, and a screen reader hears them.
  const seen = useRef<Map<string, number> | null>(null);
  const nowMs = Date.now();
  const isNew = (id: string) => {
    if (!seen.current) return false;
    const at = seen.current.get(id);
    return at === undefined || nowMs - at < 900;
  };
  const arrived = steps.filter((s) => isNew(s.event.id)).at(-1);
  useEffect(() => {
    const first = !seen.current;
    seen.current ??= new Map();
    for (const s of steps) if (!seen.current.has(s.event.id)) seen.current.set(s.event.id, first ? 0 : Date.now());
  });
  const [showAll, setShowAll] = useState(false);
  const KEEP = 4;
  const hidden = showAll ? 0 : Math.max(0, steps.length - KEEP);
  const shown = steps.slice(hidden);

  const reached = new Set(view.timeline.map((e) => e.kind));
  const lastIdx = Math.max(-1, ...DEAL_PATH.map((k, i) => (reached.has(k) ? i : -1)));
  const closed = ['SETTLED', 'CANCELLED', 'CANCELLED_REFUNDED'].includes(view.deal.state);
  const ahead = closed
    ? []
    : DEAL_PATH.slice(lastIdx + 1)
        .filter((k) => !(viewer === 'driver' && MONEY_KINDS.has(k)))
        .slice(0, 4);

  return (
    <section className="certificate bg-[var(--paper-lift)] p-5" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="headline text-2xl text-[var(--ink)]">
        {t('web.deal.timelineTitle', 'What has happened')}
      </h2>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-[var(--gold-deep)] underline decoration-[var(--gold-deep)]/40 underline-offset-4 hover:decoration-[var(--gold-deep)] lg:min-h-0"
        >
          {hidden === 1 ? t('web.deal.showOne', 'Show 1 earlier step') : t('web.deal.showEarlier', 'Show {n} earlier steps', { n: hidden })}
        </button>
      )}
      <p aria-live="polite" className="sr-only">
        {arrived && arrived.event.kind !== 'photo_added' ? words(arrived.event).title : ''}
      </p>
      <ol className="mt-4">
        {shown.map(({ event, notices, photos }, i) => {
          const w = event.kind === 'photo_added' ? { title: photos === 1 ? t('web.deal.evPhoto', 'A photo was taken at pickup') : t('web.deal.evPhotos', '{n} photos were taken at pickup', { n: photos }) } : words(event);
          const last = i === shown.length - 1 && ahead.length === 0;
          return (
            <li key={event.id} className={`relative flex gap-3.5 pb-5 ${isNew(event.id) ? 'step-new' : ''}`}>
              {!last && <span aria-hidden className="step-rail absolute left-[11px] top-6 bottom-0 w-0.5 -translate-x-1/4 rounded-full bg-[var(--forest)]/35" />}
              <span
                aria-hidden
                className={`step-dot relative mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                  event.kind === 'claim_opened' ? 'bg-[var(--stamp)] text-[var(--paper-lift)]' : 'bg-[var(--forest)] text-[var(--paper-lift)]'
                }`}
              >
                <Glyph name={event.kind === 'claim_opened' ? 'cross' : 'check'} className="h-3.5 w-3.5" />
              </span>
              <div className="step-text min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug text-[var(--ink)]">{w.title}</p>
                {w.detail && <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink-6)]">{w.detail}</p>}
                {notices.map((n) => (
                  <p key={n.id} className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-6)]">
                    <Glyph name={n.channel === 'voice' ? 'phone' : 'sms'} className="h-3.5 w-3.5 flex-shrink-0" />
                    {words(n).title}
                  </p>
                ))}
                <p className="serial mt-1 text-[11px] text-[var(--ink-6)]">
                  {dateTime(event.at)}
                  {CHANNEL_WORD(t, event.channel) && ` · ${CHANNEL_WORD(t, event.channel)}`}
                </p>
              </div>
            </li>
          );
        })}
        {ahead.map((k, i) => (
          <li key={k} className="relative flex gap-3.5 pb-4 last:pb-0">
            {i < ahead.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px border-l border-dashed border-[var(--ink-3)]" />}
            {i === 0 ? (
              // The step everyone is waiting on: a solid ring that breathes.
              <span aria-hidden className="step-current relative mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[var(--paper-lift)]">
                <span className="h-2 w-2 rounded-full bg-[var(--gold)]" />
              </span>
            ) : (
              <span aria-hidden className="relative mt-0.5 h-6 w-6 flex-shrink-0 rounded-full border-2 border-dashed border-[var(--ink-3)] bg-[var(--paper-lift)]" />
            )}
            <p className={`pt-0.5 text-[15px] ${i === 0 ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-6)]'}`}>
              {i === 0 && <span className="smallcaps mr-2 text-[var(--gold-ink)]">{t('web.deal.nextLabel', 'Next')}</span>}
              {AHEAD_WORD(t, k, view)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MONEY_KINDS = new Set(['funds_held', 'advance_paid', 'balance_paid', 'refunded', 'claim_resolved']);
const DRIVER_HIDDEN = new Set(['offer_made', 'countered', 'offer_reject', 'offer_withdraw', 'offer_expire', 'notice_sent', 'claim_opened', 'claim_answered']);

function CHANNEL_WORD(t: T, c: DealEvent['channel']): string | null {
  if (c === 'ussd') return t('web.deal.chUssd', 'on the phone menu');
  if (c === 'voice') return t('web.deal.chVoice', 'by phone call');
  if (c === 'sms') return t('web.deal.chSms', 'by text message');
  return null;
}

function AHEAD_WORD(t: T, k: string, view: DealView): string {
  const farmer = firstName(view.people.farmer.name);
  const buyer = view.people.buyer.company ?? firstName(view.people.buyer.name);
  const v = view.viewer;
  switch (k) {
    case 'funds_held':
      return t('web.deal.aHeld', 'The money is held by F2M');
    case 'driver_assigned':
      return v === 'driver' ? t('web.deal.aJobYou', 'You take the job') : t('web.deal.aJob', 'A driver takes the job');
    case 'at_pickup':
      return v === 'driver' ? t('web.deal.aFarmYou', 'You reach the farm') : t('web.deal.aFarm', 'The driver reaches the farm');
    case 'graded':
      return t('web.deal.aGraded', 'Graded at pickup');
    case 'advance_paid':
      return v === 'farmer' ? t('web.deal.aAdvanceYou', 'Your advance is paid') : t('web.deal.aAdvance', '{farmer} is paid the advance', { farmer });
    case 'departed':
      return t('web.deal.aRoad', 'On the road');
    case 'arrived':
      return v === 'buyer' ? t('web.deal.aArriveYou', 'It arrives at your door') : t('web.deal.aArrive', 'It arrives at {buyer}', { buyer });
    case 'received':
      return v === 'buyer' ? t('web.deal.aReceiveYou', 'You confirm it arrived') : t('web.deal.aReceive', '{buyer} confirms it arrived', { buyer });
    case 'balance_paid':
      return v === 'farmer' ? t('web.deal.aBalanceYou', 'Your balance is paid') : t('web.deal.aBalance', '{farmer} is paid the balance', { farmer });
    default:
      return k;
  }
}

function REASON_LABEL(t: T, r: ClaimReason): string {
  switch (r) {
    case 'short_weight':
      return t('web.deal.rShort', 'Less than agreed');
    case 'quality':
      return t('web.deal.rQuality', 'Quality not as agreed');
    case 'damaged':
      return t('web.deal.rDamaged', 'Damaged on the way');
    case 'late':
      return t('web.deal.rLate', 'Arrived late');
    case 'not_delivered':
      return t('web.deal.rMissing', 'Did not arrive');
    default:
      return t('web.deal.rOther', 'Something else');
  }
}

/** Each event in words, from where the viewer stands ("You…" or a name). */
function useEventWords(view: DealView) {
  const { t } = useT();
  const { name, isYou } = useNames(view);
  const v = view.viewer;
  const farmer = firstName(view.people.farmer.name);
  return (e: DealEvent): { title: string; detail?: string } => {
    const who = name(e.actor);
    const you = isYou(e.actor);
    const d = e.data;
    switch (e.kind) {
      case 'offer_made':
        return {
          title: you
            ? t('web.deal.evOfferYou', 'You offered {price}/kg', { price: ghs(d.pricePerKg ?? 0) })
            : t('web.deal.evOffer', '{who} offered {price}/kg', { who, price: ghs(d.pricePerKg ?? 0) }),
          detail: d.kg ? t('web.deal.evOfferKg', 'For {kg} kg', { kg: d.kg }) : undefined,
        };
      case 'countered':
        return {
          title: you
            ? t('web.deal.evCounterYou', 'You asked for {price}/kg', { price: ghs(d.pricePerKg ?? 0) })
            : t('web.deal.evCounter', '{who} asked for {price}/kg', { who, price: ghs(d.pricePerKg ?? 0) }),
        };
      case 'accepted':
        return { title: you ? t('web.deal.evAcceptYou', 'You accepted the offer') : t('web.deal.evAccept', '{who} accepted the offer', { who }) };
      case 'funds_held':
        return {
          title:
            v === 'buyer'
              ? t('web.deal.evHeldYou', 'Your {amount} is held safely by F2M', { amount: ghs(d.amount ?? 0) })
              : t('web.deal.evHeld', "The buyer's {amount} is held safely by F2M", { amount: ghs(d.amount ?? 0) }),
          detail: t('web.deal.evHeldWhy', 'Nobody can spend it until the produce is collected and graded.'),
        };
      case 'driver_assigned':
        return {
          title: you ? t('web.deal.evDriverYou', 'You took the job') : t('web.deal.evDriver', '{who} will collect it', { who }),
          detail: view.people.driver?.vehicle ?? undefined,
        };
      case 'at_pickup':
        return { title: you ? t('web.deal.evFarmYou', 'You reached the farm') : t('web.deal.evFarm', '{who} reached the farm', { who }) };
      case 'graded':
        return {
          title: t('web.deal.evGraded', 'Graded {grade} at pickup', { grade: d.grade ?? '' }),
          detail: t('web.deal.evGradedHow', 'Checked from photos taken at the farm.'),
        };
      case 'advance_paid':
        return {
          title:
            v === 'farmer'
              ? t('web.deal.evAdvanceYou', 'Your advance of {amount} was sent to your mobile money', { amount: ghs(d.amount ?? 0) })
              : t('web.deal.evAdvance', '{farmer} was paid an advance of {amount}', { farmer, amount: ghs(d.amount ?? 0) }),
        };
      case 'loaded':
        return { title: you ? t('web.deal.evLoadYou', 'You loaded the produce') : t('web.deal.evLoad', '{who} loaded the produce', { who }) };
      case 'departed':
        return { title: you ? t('web.deal.evDepartYou', 'You set off') : t('web.deal.evDepart', '{who} set off', { who }) };
      case 'arrived':
        return { title: you ? t('web.deal.evArriveYou', 'You arrived with the produce') : t('web.deal.evArrive', '{who} arrived with the produce', { who }) };
      case 'received':
        return { title: you ? t('web.deal.evReceivedYou', 'You confirmed it arrived') : t('web.deal.evReceived', '{who} confirmed it arrived', { who }) };
      case 'auto_received':
        return { title: t('web.deal.evAuto', 'Confirmed automatically after 24 hours') };
      case 'claim_opened':
        return {
          title: you
            ? t('web.deal.evClaimYou', 'You reported a problem: {reason}', { reason: REASON_LABEL(t, d.reason ?? 'other').toLowerCase() })
            : t('web.deal.evClaim', '{who} reported a problem: {reason}', { who, reason: REASON_LABEL(t, d.reason ?? 'other').toLowerCase() }),
          detail: [d.deduction ? t('web.deal.evClaimAsk', 'Asked for {amount} off.', { amount: ghs(d.deduction) }) : '', d.note ? `“${d.note}”` : '']
            .filter(Boolean)
            .join(' '),
        };
      case 'claim_answered':
        return {
          title: d.answer === 'accepted'
            ? you
              ? t('web.deal.evAnsweredYesYou', 'You accepted the deduction')
              : t('web.deal.evAnsweredYes', '{who} accepted the deduction', { who })
            : you
              ? t('web.deal.evAnsweredNoYou', 'You refused the deduction')
              : t('web.deal.evAnsweredNo', '{who} refused the deduction', { who }),
          detail: d.answer === 'accepted' ? undefined : t('web.deal.evAnsweredNoWhy', 'F2M will look at it and decide.'),
        };
      case 'claim_resolved':
        return {
          title: d.finalDeduction
            ? t('web.deal.evResolved', 'F2M decided: {amount} off', { amount: ghs(d.finalDeduction) })
            : t('web.deal.evResolvedNone', 'F2M decided: nothing taken off'),
          detail: d.note,
        };
      case 'balance_paid':
        return {
          title:
            v === 'farmer'
              ? t('web.deal.evBalanceYou', 'Your balance of {amount} was sent to your mobile money', { amount: ghs(d.amount ?? 0) })
              : t('web.deal.evBalance', '{farmer} was paid the balance of {amount}', { farmer, amount: ghs(d.amount ?? 0) }),
        };
      case 'driver_paid':
        return {
          title:
            v === 'driver'
              ? d.amount
                ? t('web.deal.evFeeYou', 'Your fee of {amount} was paid', { amount: ghs(d.amount) })
                : t('web.deal.evFeeYouPlain', 'Your fee was paid to your mobile money')
              : t('web.deal.evFee', 'The driver was paid'),
        };
      case 'offer_reject':
        return { title: you ? t('web.deal.evRejectYou', 'You turned the offer down') : t('web.deal.evReject', '{who} turned the offer down', { who }) };
      case 'offer_withdraw':
        return { title: you ? t('web.deal.evWithdrawYou', 'You withdrew the offer') : t('web.deal.evWithdraw', '{who} withdrew the offer', { who }) };
      case 'offer_expire':
        return { title: t('web.deal.evExpire', 'The offer ran out of time') };
      case 'funding_failed':
        return { title: t('web.deal.evFundFail', 'The payment did not go through') };
      case 'transport_suggested':
        return { title: you ? t('web.deal.evSuggestYou', 'You asked for a driver') : t('web.deal.evSuggest', '{who} asked for a driver', { who }) };
      case 'transport_requested':
        return { title: t('web.deal.evRequested', 'F2M is looking for a driver on this road') };
      case 'transport_funded':
        return { title: v === 'driver' ? t('web.deal.evFundedYou', 'Your fee is held for you') : t('web.deal.evFunded', "The driver's fee is held") };
      case 'transport_cancelled':
        return { title: t('web.deal.evTransportCancelled', 'The pickup was cancelled') };
      case 'collected':
        return { title: t('web.deal.evCollected', 'Collected from the farm') };
      case 'grade_disputed':
        return { title: you ? t('web.deal.evDisputeYou', 'You questioned the grade') : t('web.deal.evDispute', '{who} questioned the grade', { who }) };
      case 'regraded':
        return { title: t('web.deal.evRegraded', 'Graded again: {grade}', { grade: d.grade ?? '' }) };
      case 'delivered':
        return { title: t('web.deal.evDelivered', 'Delivered') };
      case 'settled':
        return { title: t('web.deal.evSettled', 'Sale complete') };
      case 'cancelled':
        return { title: t('web.deal.evCancelled', 'The sale was cancelled') };
      case 'refunded':
        return { title: v === 'buyer' ? t('web.deal.evRefundYou', 'Your money was returned') : t('web.deal.evRefund', "The buyer's money was returned") };
      case 'notice_sent': {
        const to = d.to ?? 'farmer';
        const langName = d.locale ? LANGUAGE_NAME[d.locale] : null;
        const lang = langName && d.locale !== 'en' ? t('web.deal.inLanguage', ' in {language}', { language: langName }) : '';
        if (to === v) return { title: e.channel === 'voice' ? t('web.deal.ntCalledYou', 'We called you{lang}', { lang }) : t('web.deal.ntTextedYou', 'We sent you a text{lang}', { lang }) };
        const whom = name(to);
        return {
          title: e.channel === 'voice' ? t('web.deal.ntCalled', '{who} was called{lang}', { who: whom, lang }) : t('web.deal.ntTexted', '{who} was sent a text{lang}', { who: whom, lang }),
        };
      }
      default:
        return { title: e.kind };
    }
  };
}

/* ── People ─────────────────────────────────────────────────────────────── */

function PeopleCard({ view }: { view: DealView }) {
  const { t } = useT();
  const { people, viewer } = view;
  const rows: Array<{ role: DealRole; name: string; line: string | null; phone?: string | null }> = [
    {
      role: 'farmer',
      name: people.farmer.name,
      line: [t('web.deal.pFarmer', 'Farmer'), [people.farmer.district, people.farmer.region].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      phone: people.farmer.phone,
    },
    { role: 'buyer', name: people.buyer.company ?? people.buyer.name, line: [t('web.deal.pBuyer', 'Buyer'), people.buyer.company ? people.buyer.name : null].filter(Boolean).join(' · '), phone: people.buyer.phone },
  ];
  if (people.driver) rows.push({ role: 'driver', name: people.driver.name, line: [t('web.deal.pDriver', 'Driver'), people.driver.vehicle].filter(Boolean).join(' · '), phone: people.driver.phone });

  return (
    <section className="certificate bg-[var(--paper-lift)] p-5" aria-labelledby="people-title">
      <p id="people-title" className="smallcaps text-[var(--ink-6)]">
        {t('web.deal.peopleTitle', 'Who is in this sale')}
      </p>
      <ul className="mt-2 divide-y divide-[var(--ink-1)]">
        {rows.map((r) => (
          <li key={r.role} className="flex items-center gap-3 py-2.5">
            <Glyph name={r.role === 'driver' ? 'driver' : r.role === 'farmer' ? 'farmer' : 'basket'} className="h-6 w-6 flex-shrink-0 text-[var(--ink-6)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                {r.name}
                {r.role === viewer && <span className="ml-1.5 text-xs font-normal text-[var(--ink-6)]">{t('web.deal.youTag', '(you)')}</span>}
              </p>
              {r.line && <p className="truncate text-xs text-[var(--ink-6)]">{r.line}</p>}
            </div>
            {r.phone && r.role !== viewer && (
              <a
                href={`tel:${r.phone}`}
                className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-[var(--ink-3)] text-[var(--ink)] transition-[background-color,scale] hover:bg-[var(--paper-deep)] active:scale-[0.95] lg:h-9 lg:w-9"
                aria-label={t('web.deal.callWho', 'Call {name}', { name: r.name })}
              >
                <Glyph name="phone" className="h-4 w-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <Link to={`/t/${view.deal.lotId}`} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--gold-deep)] underline decoration-[var(--gold-deep)]/40 underline-offset-4 hover:decoration-[var(--gold-deep)] lg:min-h-0">
        {t('web.deal.publicRecord', 'Public record of this lot')}
      </Link>
    </section>
  );
}

/** An amount that counts to its new value when it changes while you watch
 *  (never on first paint, never with reduced motion). */
function Amount({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{ghs(shown)}</span>;
}

/* ── Sheets ─────────────────────────────────────────────────────────────── */

/** After a money moment: a drawn tick, what happens next, and a reference. */
function SuccessSheet({ title, body, reference, onClose }: { title: string; body: string; reference: string; onClose: () => void }) {
  const { t } = useT();
  const id = useId();
  return (
    <Modal label={title} labelledBy={id} onClose={onClose}>
      <div className="certificate mx-auto max-w-md bg-[var(--paper-lift)] px-6 pb-6 pt-8 text-center">
        <svg viewBox="0 0 56 56" className="check-draw mx-auto h-16 w-16 text-[var(--forest)]" aria-hidden>
          <circle cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="3" pathLength={1} />
          <path d="M17 29l7.5 7.5L40 21" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        </svg>
        <h2 id={id} className="headline mt-4 text-3xl text-[var(--ink)]">
          {title}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-[var(--ink-7)]">{body}</p>
        <p className="serial mt-3 text-xs text-[var(--ink-6)]">{t('web.deal.reference', 'Reference {ref}', { ref: reference })}</p>
        <button type="button" className={`${btnCls} mt-6 w-full`} onClick={onClose}>
          {t('web.deal.doneBtn', 'Done')}
        </button>
      </div>
    </Modal>
  );
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <Modal label={title} labelledBy={id} onClose={onClose}>
      <div className="certificate mx-auto max-w-lg overflow-hidden bg-[var(--paper-lift)]">
        <div className="plate on-dark flex items-start justify-between gap-4 px-5 py-4">
          <h2 id={id} className="headline text-2xl">
            {title}
          </h2>
          <button type="button" className={plateBtnCls} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </Modal>
  );
}

function ConfirmSheet({
  title,
  body,
  confirm,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <SheetFrame title={title} onClose={onClose}>
      <p className="text-[15px] leading-relaxed text-[var(--ink-7)]">{body}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={btnGhostCls} onClick={onClose}>
          {t('web.deal.notYet', 'Not yet')}
        </button>
        <button type="button" className={btnCls} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          <BusyLabel busy={busy} label={confirm} />
        </button>
      </div>
    </SheetFrame>
  );
}

const REASONS: ClaimReason[] = ['short_weight', 'quality', 'damaged', 'late', 'not_delivered', 'other'];

function ReportSheet({
  view,
  busy,
  onClose,
  onSend,
}: {
  view: DealView;
  busy: boolean;
  onClose: () => void;
  onSend: (c: { reason: ClaimReason; note: string; deduction: number }) => void;
}) {
  const { t } = useT();
  const ids = { reason: useId(), kg: useId(), amount: useId(), note: useId() };
  const max = view.money?.stillHeld ?? 0;
  const farmer = firstName(view.people.farmer.name);
  const [reason, setReason] = useState<ClaimReason | null>(null);
  const [kgArrived, setKgArrived] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; amount?: string }>({});

  // Short weight: the buyer says how much came, and the deduction follows from the price.
  const onKg = (v: string) => {
    setKgArrived(v);
    const kg = Number(v);
    if (v && Number.isFinite(kg) && kg >= 0 && kg < view.deal.quantityKg) {
      const off = Math.min(max, Math.round((view.deal.quantityKg - kg) * (view.deal.pricePerKg ?? 0)));
      setAmount((off / 100).toFixed(2));
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pesewas = Math.round(Number(amount) * 100);
    const found: typeof errors = {};
    if (!reason) found.reason = t('web.deal.errReason', 'Choose what went wrong.');
    if (!amount || !Number.isFinite(pesewas) || pesewas <= 0) found.amount = t('web.deal.errAmount', 'Enter how much to take off.');
    else if (pesewas > max) found.amount = t('web.deal.errTooMuch', 'You can ask for at most {max}, the balance still held.', { max: ghs(max) });
    setErrors(found);
    if (Object.keys(found).length || !reason) return;
    onSend({ reason, note: note.trim(), deduction: pesewas });
  };

  return (
    <SheetFrame title={t('web.deal.reportTitle', 'Report a problem')} onClose={onClose}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <FieldSet id={ids.reason} legend={t('web.deal.reasonLegend', 'What went wrong?')} error={errors.reason}>
          <div className="grid gap-2 sm:grid-cols-2">
            {REASONS.map((r) => (
              <RadioCard key={r} name={ids.reason} value={r} checked={reason === r} onChange={() => setReason(r)} title={REASON_LABEL(t, r)} />
            ))}
          </div>
        </FieldSet>

        {reason === 'short_weight' && (
          <FormField id={ids.kg} label={t('web.deal.kgLabel', 'How much arrived?')} hint={t('web.deal.kgHint', 'You agreed on {kg} kg.', { kg: view.deal.quantityKg })}>
            <div className={affixWrapCls}>
              <input
                {...fieldAria(ids.kg, null, `${ids.kg}-hint`)}
                className={affixInputCls}
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                value={kgArrived}
                onChange={(e) => onKg(e.target.value)}
              />
              <span className={`${affixTextCls} pr-3`}>kg</span>
            </div>
          </FormField>
        )}

        <FormField
          id={ids.amount}
          label={t('web.deal.amountLabel', 'Take off')}
          error={errors.amount}
          hint={t('web.deal.amountHint', 'Up to {max}, the balance still held for {farmer}.', { max: ghs(max), farmer })}
        >
          <div className={affixWrapCls}>
            <span className={`${affixTextCls} pl-3 font-semibold`}>GHS</span>
            <input
              {...fieldAria(ids.amount, errors.amount, `${ids.amount}-hint`)}
              className={affixInputCls}
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </FormField>

        <FormField id={ids.note} label={t('web.deal.noteLabel', 'What happened')} optional={t('web.deal.optional', 'Optional')}>
          <textarea
            {...fieldAria(ids.note)}
            className={`${fieldCls} min-h-20`}
            rows={3}
            enterKeyHint="send"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('web.deal.notePh', 'Two bags were light. We weighed 460 kg.')}
          />
        </FormField>

        <p className="rounded-2xl bg-[var(--paper-deep)] px-3.5 py-3 text-sm leading-relaxed text-[var(--ink-7)]">
          {t(
            'web.deal.reportHow',
            '{farmer} is told by phone and can accept or refuse. If they refuse, F2M looks at the photos from pickup and decides. The rest of the money stays held until then.',
            { farmer },
          )}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            {t('web.deal.cancel', 'Cancel')}
          </button>
          <button type="submit" className={btnCls} disabled={busy} aria-busy={busy || undefined}>
            <BusyLabel busy={busy} label={t('web.deal.sendReport', 'Send to {farmer}', { farmer })} />
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}

/* ── Actions ────────────────────────────────────────────────────────────── */

type DealAction =
  | { kind: 'receive' }
  | { kind: 'claim'; reason: ClaimReason; note: string; deduction: number }
  | { kind: 'answer'; claimId: string; accept: boolean }
  | { kind: 'driver'; step: string };

const DRIVER_PATH: Record<string, string> = { at_pickup: 'at-pickup', loaded: 'pickup', departed: 'departed', arrived: 'arrived' };

function useDealAction(view: DealView, sample: boolean) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const contractId = view.deal.id;
  return useMutation({
    mutationFn: async (a: DealAction) => {
      if (sample) return a;
      if (a.kind === 'receive') await api(`/api/contracts/${contractId}/receive`, { method: 'POST' });
      else if (a.kind === 'claim')
        await api(`/api/contracts/${contractId}/claims`, {
          method: 'POST',
          body: JSON.stringify({ reason: a.reason, note: a.note || undefined, deduction: a.deduction }),
        });
      else if (a.kind === 'answer') await api(`/api/farmer/claims/${a.claimId}/answer`, { method: 'POST', body: JSON.stringify({ accept: a.accept }) });
      else if (view.transport && DRIVER_PATH[a.step]) await api(`/api/jobs/${view.transport.jobId}/${DRIVER_PATH[a.step]}`, { method: 'POST' });
      return a;
    },
    onSuccess: (a) => {
      const farmer = firstName(view.people.farmer.name);
      const msg =
        a.kind === 'receive'
          ? t('web.deal.tReceived', 'Confirmed. {farmer} is being paid the balance.', { farmer })
          : a.kind === 'claim'
            ? t('web.deal.tClaim', 'Sent. {farmer} will be called and asked to answer.', { farmer })
            : a.kind === 'answer'
              ? a.accept
                ? t('web.deal.tAccepted', 'Accepted. Your balance is on its way.')
                : t('web.deal.tRefused', 'Refused. F2M will look at it and let you know.')
              : t('web.deal.tStep', 'Done. Everyone in the sale can see it.');
      // Money moments get their own success sheet; driver steps are quick, so a toast.
      if (a.kind === 'driver') {
        haptic('success');
        toast(sample ? t('web.deal.tSample', 'Sample only: {msg}', { msg }) : msg);
      }
      if (!sample) void queryClient.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

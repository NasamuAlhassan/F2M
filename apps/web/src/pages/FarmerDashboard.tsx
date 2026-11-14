import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type FarmerDashboard, type Registries } from '../api';
import { POLL } from '../poll';
import { CropMark, cropAccent, cropPhoto, Glyph } from '../components/engrave';
import { LanguageSection } from '../components/LanguageSection';
import { PriceHint } from '../components/PriceHint';
import { btnCls, btnGhostCls, EmptyState, ErrorStamp, GradeBadge, Greeting, inputCls, LoadGate, numCls, greetingFor, StateBadge, tableCls, TableScroll, tdCls, thCls, toast, affixInputCls, affixTextCls, affixWrapCls, BusyLabel, FieldError, hitAreaCls, textLinkCls, FieldSet, fieldAria, fieldCls, FormField, RadioCard, pillCls } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAccount } from '../lib/session';

interface PriceRow {
  commodityCode: string;
  pricePerKg: number;
}

/** The manifest desk: "List a New Lot". Same registerLot the USSD tree calls. */
function ListLotForm({ registries, momoMsisdn }: { registries: Registries; momoMsisdn: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [commodityCode, setCommodityCode] = useState(registries.commodities[0]?.code ?? '');
  const commodity = registries.commodities.find((c) => c.code === commodityCode);
  const units = commodity?.units ?? [];
  const [unitCode, setUnitCode] = useState('');
  const activeUnit = units.find((u) => u.code === unitCode) ?? units[0];
  const [unitQty, setUnitQty] = useState('10');
  const [declaredBand, setDeclaredBand] = useState<'A' | 'B' | 'C'>('B');
  const [askPerUnit, setAskPerUnit] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errors, setErrors] = useState<{ qty?: string; price?: string }>({});
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  // A ref as well as isPending: two taps inside one frame both see isPending=false.
  const sending = useRef(false);

  // The "Lot listed ✓" tick must not fire onto an unmounted form, and a second
  // listing restarts the two seconds instead of inheriting the first's tail.
  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  // Thumbnails: one object URL per chosen photo, released as soon as the set
  // changes or the form goes away (made in the effect, so StrictMode's double
  // run cannot revoke a URL an <img> is still showing).
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const askPerKg = activeUnit && askPerUnit ? Math.round((Number(askPerUnit) * 100) / activeUnit.kgPerUnit) : null;

  const list = useMutation({
    mutationFn: async () => {
      const res = await api<{ lot: { id: string } }>('/api/farmer/lots', {
        method: 'POST',
        body: JSON.stringify({
          commodityCode,
          unitCode: activeUnit?.code,
          unitQty: Number(unitQty),
          declaredBand,
          askingPricePerKg: askPerKg ?? undefined,
        }),
      });
      // Card art: upload the chosen produce photos onto the fresh listing. The
      // lot is already committed by this point, so a refused photo must never
      // reject the whole mutation — a farmer who reads that as failure lists
      // the same produce twice. Photos are the cosmetic half; name the ones
      // that fell off and let the lot stand.
      const failedPhotos: string[] = [];
      for (const file of files.slice(0, 3)) {
        const form = new FormData();
        form.append('photo', file);
        try {
          await api(`/api/farmer/lots/${res.lot.id}/photos`, { method: 'POST', body: form });
        } catch {
          failedPhotos.push(file.name);
        }
      }
      return { ...res, failedPhotos };
    },
    onSuccess: ({ failedPhotos }) => {
      queryClient.invalidateQueries({ queryKey: ['farmer-dashboard'] });
      const crop = registries.commodities.find((c) => c.code === commodityCode)?.name ?? 'produce';
      toast(t('web.listLot.listedToast', 'Your {crop} is on the market. Buyers can see it now.', { crop: crop.toLowerCase() }));
      setAskPerUnit('');
      setFiles([]);
      setPhotoNote(null);
      setError(
        failedPhotos.length === 0
          ? null
          : failedPhotos.length === 1
            ? t('web.listLot.photoFailedOne', 'Your lot is listed, but 1 photo did not upload: {names}', { names: failedPhotos.join(', ') })
            : t('web.listLot.photoFailedMany', 'Your lot is listed, but {count} photos did not upload: {names}', {
                count: failedPhotos.length,
                names: failedPhotos.join(', '),
              }),
      );
      setDone(true);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDone(false), 2000);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t('web.listLot.failed', 'Could not list your lot. Check your connection and try again.')),
  });

  const kg = activeUnit ? Math.round(activeUnit.kgPerUnit * Number(unitQty) * 10) / 10 : 0;
  const unitName = activeUnit?.name ?? t('web.listLot.unitFallback', 'unit');

  // Number('') is 0, so an emptied quantity box would otherwise post a
  // zero-unit lot; a typed minus sign would post a negative ask. Neither
  // belongs on the ledger, and both are caught here, on blur and on submit.
  function checkQty(v: string): string | undefined {
    if (!v.trim()) return t('web.listLot.qtyMissing', 'Enter how many you have, like 10.');
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return t('web.listLot.qtyInvalid', 'Enter a number above 0, like 10.');
    return undefined;
  }
  function checkPrice(v: string): string | undefined {
    if (!v.trim()) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return t('web.listLot.priceInvalid', 'Enter the price in numbers only, like 250, or leave it empty.');
    return undefined;
  }

  // Static keys, so i18n:extract finds every one.
  const gradeText: Record<'A' | 'B' | 'C', { title: string; detail: string }> = {
    A: { title: t('web.listLot.gradeATitle', 'Best quality'), detail: t('web.listLot.gradeADetail', 'Top of the harvest: clean, dry, even size') },
    B: { title: t('web.listLot.gradeBTitle', 'Good quality'), detail: t('web.listLot.gradeBDetail', 'Good everyday produce, a few small marks') },
    C: { title: t('web.listLot.gradeCTitle', 'Fair quality'), detail: t('web.listLot.gradeCDetail', 'Smaller or some damage. Sells for less') },
  };

  function addPhotos(picked: FileList | null) {
    const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
    const merged = [...files];
    for (const f of Array.from(picked ?? [])) if (!merged.some((m) => sameFile(m, f))) merged.push(f);
    setPhotoNote(merged.length > 3 ? t('web.listLot.photoLimit', 'You can add up to 3 photos. We kept the first 3.') : null);
    setFiles(merged.slice(0, 3));
  }

  function removePhoto(index: number) {
    setFiles((cur) => cur.filter((_, i) => i !== index));
    setPhotoNote(null);
    // The button that had focus is gone; hand focus to the picker instead of the page top.
    requestAnimationFrame(() => document.getElementById('lot-photos')?.focus());
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || list.isPending) return;
    const found = { qty: checkQty(unitQty), price: checkPrice(askPerUnit) };
    setErrors(found);
    if (found.qty || found.price) {
      document.getElementById(found.qty ? 'lot-qty' : 'lot-price')?.focus();
      return;
    }
    if (!activeUnit) {
      setError(t('web.listLot.noUnit', 'This crop cannot be listed yet. Choose another crop.'));
      return;
    }
    setError(null);
    sending.current = true;
    list.mutate(undefined, {
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  const priceHint = (
    <>
      {askPerKg !== null && !errors.price && Number.isFinite(askPerKg) && (
        <span className="serial mb-1 block text-sm text-[var(--ink-7)]">
          {t('web.listLot.perKg', 'That is {price} per kg.', { price: ghs(askPerKg) })}
        </span>
      )}
      {askPerUnit === '' && <span className="block">{t('web.listLot.priceHint', 'Leave it empty to sell at the market price.')}</span>}
    </>
  );

  return (
    <aside>
      <div className="certificate overflow-hidden bg-[var(--paper-lift)]">
        <div className="plate on-dark px-5 py-5">
          <h2 id="lot-form-title" className="headline text-2xl">
            {t('web.listLot.heading', 'List your produce')}
          </h2>
        </div>
        <form
          noValidate
          onSubmit={submit}
          aria-labelledby="lot-form-title"
          aria-busy={list.isPending}
          className="flex flex-col gap-5 p-5"
        >
          <FormField id="lot-crop" label={t('web.listLot.cropLabel', 'Crop')}>
            <select
              id="lot-crop"
              name="crop"
              className={fieldCls}
              value={commodityCode}
              onChange={(e) => {
                setCommodityCode(e.target.value);
                setUnitCode('');
              }}
            >
              {registries.commodities.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset className="m-0 min-w-0 border-0 p-0 text-sm">
            <legend className="smallcaps mb-1.5 p-0 text-[var(--ink-6)]">{t('web.listLot.qtyLegend', 'How much')}</legend>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              <input
                {...fieldAria('lot-qty', errors.qty, 'lot-qty-kg')}
                aria-label={t('web.listLot.qtyNumber', 'How many')}
                className={`${fieldCls} serial`}
                type="text"
                inputMode="decimal"
                name="quantity"
                autoComplete="off"
                spellCheck={false}
                value={unitQty}
                onChange={(e) => {
                  const v = e.target.value.replace(/\s+/g, '');
                  setUnitQty(v);
                  if (errors.qty && !checkQty(v)) setErrors((c) => ({ ...c, qty: undefined }));
                }}
                onBlur={() => {
                  if (unitQty || errors.qty) setErrors((c) => ({ ...c, qty: checkQty(unitQty) }));
                }}
              />
              <select
                id="lot-unit"
                name="unit"
                aria-label={t('web.listLot.unitLabel', 'Unit')}
                className={fieldCls}
                value={activeUnit?.code ?? ''}
                onChange={(e) => setUnitCode(e.target.value)}
              >
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <FieldError id="lot-qty-error" message={errors.qty} />
            <p id="lot-qty-kg" className="serial mt-1.5 text-sm font-semibold text-[var(--ink-7)]">
              {Number.isFinite(kg) && kg > 0 ? t('web.listLot.kgTotal', '= {kg} kg in total', { kg: kg.toLocaleString('en-GH') }) : null}
            </p>
          </fieldset>

          <FieldSet
            id="lot-grade"
            legend={t('web.listLot.gradeLegend', 'Quality')}
            hint={t('web.listLot.gradeHint', 'Your best guess. The grade checked at pickup decides what you are paid.')}
          >
            <div className="flex flex-col gap-2">
              {(['A', 'B', 'C'] as const).map((g) => (
                <RadioCard
                  key={g}
                  name="declaredBand"
                  value={g}
                  checked={declaredBand === g}
                  onChange={() => setDeclaredBand(g)}
                  icon={<GradeBadge grade={g} />}
                  title={gradeText[g].title}
                  detail={gradeText[g].detail}
                />
              ))}
            </div>
          </FieldSet>

          <FormField
            id="lot-price"
            label={t('web.listLot.priceLabel', 'Your price')}
            optional={t('web.form.optional', 'Optional')}
            error={errors.price}
            hint={priceHint}
          >
            <div className={affixWrapCls}>
              <span id="lot-price-pre" className={`${affixTextCls} pl-3 font-semibold`}>
                GHS
              </span>
              <input
                {...fieldAria('lot-price', errors.price, 'lot-price-pre', 'lot-price-per', 'lot-price-hint')}
                className={affixInputCls}
                type="text"
                inputMode="decimal"
                name="price"
                autoComplete="off"
                spellCheck={false}
                value={askPerUnit}
                onChange={(e) => {
                  const v = e.target.value.replace(/\s+/g, '');
                  setAskPerUnit(v);
                  if (errors.price && !checkPrice(v)) setErrors((c) => ({ ...c, price: undefined }));
                }}
                onBlur={() => setErrors((c) => ({ ...c, price: checkPrice(askPerUnit) }))}
              />
              <span id="lot-price-per" className={`${affixTextCls} max-w-[55%] truncate pr-3`}>
                {t('web.listLot.perUnit', 'per {unit}', { unit: unitName })}
              </span>
            </div>
            <PriceHint
              commodityCode={commodityCode}
              unitCode={activeUnit?.code ?? null}
              price={askPerUnit.trim() && Number(askPerUnit) > 0 && !errors.price ? Math.round(Number(askPerUnit) * 100) : null}
              side="sell"
            />
          </FormField>

          <FieldSet
            id="lot-photos-group"
            legend={t('web.listLot.photosLegend', 'Photos')}
            hint={t('web.listLot.photosHint', 'Up to 3. Buyers see them on your listing.')}
          >
            {files.length > 0 && (
              <ul className="mb-2 grid grid-cols-3 gap-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${f.lastModified}`}
                    className="relative aspect-square overflow-hidden rounded-xl border border-[var(--ink-2)] bg-[var(--paper-deep)]"
                  >
                    {previews[i] && (
                      <img
                        src={previews[i]}
                        alt={t('web.listLot.photoAlt', 'Photo {n}: {name}', { n: i + 1, name: f.name })}
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={t('web.listLot.removePhoto', 'Remove photo {n}: {name}', { n: i + 1, name: f.name })}
                      className="group absolute right-0 top-0 flex h-11 w-11 items-center justify-center"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)]/80 text-[var(--paper-lift)] shadow-sm transition-[background-color,scale] group-hover:bg-[var(--stamp-deep)] group-active:scale-[0.94] group-active:bg-[var(--stamp-deep)]">
                        <Glyph name="cross" className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {files.length < 3 ? (
              <label className="flex min-h-[72px] cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[var(--ink-4)] bg-[var(--paper)] px-4 py-3 transition-colors hover:border-[var(--forest)] hover:bg-[var(--forest-wash)] active:bg-[var(--forest-wash)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--forest-night)]">
                <input
                  id="lot-photos"
                  type="file"
                  name="photos"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  aria-describedby="lot-photos-group-hint lot-photos-note"
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    // Let the same photo be picked again after it is removed.
                    e.target.value = '';
                  }}
                />
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--forest-wash)] text-[var(--forest-deep)]">
                  <Glyph name="camera" className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--ink)]">
                    {files.length === 0 ? t('web.listLot.addPhotos', 'Add photos') : t('web.listLot.addAnother', 'Add another photo')}
                  </span>
                  <span className="block text-xs text-[var(--ink-6)]">
                    {t('web.listLot.photoCount', '{count} of 3 added', { count: files.length })}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-[var(--ink-6)]">{t('web.listLot.photosFull', '3 of 3 photos added. Remove one to change it.')}</p>
            )}
            <p
              id="lot-photos-note"
              aria-live="polite"
              className={photoNote ? 'mt-1.5 text-[13px] font-medium text-[var(--gold-ink)]' : 'sr-only'}
            >
              {photoNote}
            </p>
          </FieldSet>

          <FormField
            id="lot-momo"
            label={t('web.listLot.momoLabel', 'MoMo payout number')}
            hint={t('web.listLot.momoHint', 'Set when you registered by USSD. Your money is paid here.')}
          >
            <input
              {...fieldAria('lot-momo', null, 'lot-momo-hint')}
              className={`${inputCls} serial min-h-11 bg-[var(--paper-deep)] text-[var(--ink-6)] lg:min-h-0`}
              type="tel"
              autoComplete="tel"
              value={`+${momoMsisdn}`}
              readOnly
            />
          </FormField>

          {error && <ErrorStamp message={error} onDismiss={() => setError(null)} />}
          <button
            type="submit"
            className={`${btnCls} w-full py-2.5`}
            aria-disabled={list.isPending || undefined}
            aria-busy={list.isPending || undefined}
          >
            {done ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Glyph name="check" className="h-4 w-4" />
                {t('web.listLot.listed', 'Lot listed')}
              </span>
            ) : (
              <BusyLabel busy={list.isPending} label={t('web.listLot.submit', 'List lot')} busyLabel={t('web.listLot.submitting', 'Listing…')} />
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}

/** Take a listing off the market (same withdrawLot as USSD); asks once inline before doing it. */
function RemoveListing({ lotId }: { lotId: string }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/api/farmer/lots/${lotId}/withdraw`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['farmer-dashboard'] }),
  });
  if (remove.error) return <ErrorStamp message={remove.error.message} onDismiss={() => remove.reset()} />;
  if (!asking) {
    return (
      <button type="button" className={btnGhostCls} onClick={() => setAsking(true)}>
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--ink-6)]">
      Remove from the market?
      <button
        type="button"
        className={btnCls}
        disabled={remove.isPending}
        aria-busy={remove.isPending || undefined}
        onClick={() => remove.mutate()}
      >
        <BusyLabel busy={remove.isPending} label="Yes, remove" busyLabel="Removing…" />
      </button>
      <button type="button" className={btnGhostCls} disabled={remove.isPending} onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

export function FarmerDashboardPage() {
  const queryClient = useQueryClient();
  const { t } = useT();
  const { account } = useAccount();
  const {
    data: registries,
    isError: registriesFailed,
    refetch: refetchRegistries,
  } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['farmer-dashboard'],
    queryFn: () => api<FarmerDashboard>('/api/farmer/dashboard'),
    refetchInterval: POLL.active,
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['farmer-dashboard'] });
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Action failed');

  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/accept`, { method: 'POST' }),
    onSuccess: () => {
      toast(t('web.farmer.acceptedToast', "Offer accepted. The buyer's money is now held for you."));
      return invalidate();
    },
    onError,
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/decline`, { method: 'POST' }),
    onSuccess: () => {
      toast(t('web.farmer.declinedToast', 'Offer declined. Your produce stays on the market.'), 'info');
      return invalidate();
    },
    onError,
  });
  // Accept and Decline answer the same bid, so either one in flight locks both
  // on every row — a double-tap must not send one contract two ways.
  const deciding = accept.isPending || decline.isPending;

  // TRANSPORT_SUGGESTED lands on the lot's trace, not in the dashboard payload,
  // so "already asked" is only remembered for this session — a refresh re-offers
  // the button. Server state would settle it; until then the scoped guard at
  // least keeps a double-tap from calling the same buyer twice.
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const suggest = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/suggest-transport`, { method: 'POST' }),
    onSuccess: (_data, id) => setSuggested((prev) => new Set(prev).add(id)),
    onError,
  });
  const setLocale = useMutation({
    mutationFn: (locale: string) => api('/api/farmer/profile', { method: 'PATCH', body: JSON.stringify({ locale }) }),
    onSuccess: invalidate,
    onError,
  });

  // Either query can be the one that did not arrive, so the gate watches both —
  // and gating on !data keeps a failed poll from blanking a dashboard that
  // already has figures on it.
  if (!data || !registries)
    return (
      <LoadGate
        isError={isError || registriesFailed}
        retrying={isFetching}
        onRetry={() => {
          void refetch();
          void refetchRegistries();
        }}
        label="your dashboard"
      />
    );
  const { stats, offers, contracts, lots, payouts, profile } = data;
  const liveLots = lots.filter((l) => ['registered', 'matched'].includes(l.status));
  const summary =
    offers.length > 0
      ? offers.length === 1
        ? t('web.farmer.summaryOffer', 'A buyer has made you an offer. It is waiting for your answer below.')
        : t('web.farmer.summaryOffers', '{n} buyers have made you offers. They are waiting for your answer below.', { n: offers.length })
      : liveLots.length > 0
        ? liveLots.length === 1
          ? t('web.farmer.summaryLot', 'Your listing is on the market. We will text and call you the moment a buyer makes an offer.')
          : t('web.farmer.summaryLots', 'Your {n} listings are on the market. We will text and call you the moment a buyer makes an offer.', {
              n: liveLots.length,
            })
        : t('web.farmer.summaryEmpty', 'List what you have harvested, and buyers across Ghana will see it within seconds.');

  return (
    <>
    <Greeting
      greeting={greetingFor(t)}
      name={account?.name ?? profile.name ?? ''}
      summary={summary}
    />
    {/* Phones read one column in the order a seller acts: an offer to answer,
        the figures, the form, the sales, and the settings last. From lg the
        form and the language sit in their own column, as before. */}
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="contents lg:block lg:w-72 lg:flex-shrink-0 lg:space-y-4">
        <div className="order-3 lg:order-none">
          <ListLotForm registries={registries} momoMsisdn={profile.momoMsisdn} />
        </div>
        <div className="certificate order-9 bg-[var(--paper-lift)] p-5 lg:order-none">
          <LanguageSection current={profile.locale} saving={setLocale.isPending} onPick={(code) => setLocale.mutate(code)} />
        </div>
      </div>

      <div className="contents lg:block lg:min-w-0 lg:flex-1">
        {error && (
          <ErrorStamp message={error} onDismiss={() => setError(null)} className="order-first lg:mb-4" />
        )}

        {/* Standing figures */}
        <div className="order-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:order-none lg:mb-8">
          <div className="certificate bg-[var(--paper-lift)] p-5">
            <div className="serial text-3xl font-bold text-[var(--ink)]">{stats.activeListings}</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">{t('web.farmer.statListings', 'On the market')}</div>
          </div>
          <div className="certificate bg-[var(--paper-lift)] p-5">
            <div className="serial text-3xl font-bold text-[var(--ink)]">{stats.matchedContracts}</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">{t('web.farmer.statSales', 'Sales in progress')}</div>
          </div>
          <div className="certificate col-span-2 bg-[var(--paper-lift)] p-5 sm:col-span-1">
            <div className="serial text-3xl font-bold text-[var(--gold-deep)]">{ghs(stats.totalEarned)}</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">{t('web.farmer.statEarned', 'Earned so far')}</div>
          </div>
        </div>

        {/* Incoming bids = OFFERED contracts, the same domain calls as USSD */}
        <section className={`${offers.length > 0 ? 'order-1' : 'order-6'} lg:order-none`}>
        <h2 className="rule-double mb-4 flex items-center gap-2 pb-2 headline text-2xl text-[var(--ink)]">
          {t('web.farmer.offersTitle', 'Offers waiting for you')}
          {offers.length > 0 && (
            <span className="serial ml-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--gold-bright)] px-1.5 font-sans text-xs font-bold text-[var(--forest-night)]">
              {offers.length}
            </span>
          )}
        </h2>
        <div className="flex flex-col gap-2 lg:mb-5">
          {offers.length === 0 ? (
            <EmptyState
              compact
              icon={<Glyph name="bell" className="h-5 w-5" />}
              title={t('web.farmer.noOffersTitle', 'No offers yet')}
              body={t(
                'web.farmer.noOffersBody',
                'When a buyer wants your produce, the offer appears here, and we text and call your phone too.',
              )}
            />
          ) : (
            offers.map((o) => (
              <div key={o.id} className="certificate seal-land flex flex-wrap items-center gap-4 bg-[var(--gold-wash)] p-4">
                <div className="min-w-44 flex-1">
                  <div className="text-sm font-bold text-[var(--ink)]">{o.buyerName}</div>
                  <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                    {o.quantityKg}kg {o.commodityName} · up to{' '}
                    <span className="serial font-bold">{ghs(o.bestPricePerKg)}/kg</span>
                    {o.expiresAt && <> · expires {shortDate(o.expiresAt)}</>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="serial text-lg font-bold text-[var(--gold-deep)]">{ghs(o.holdAmount)}</div>
                  <div className="text-xs text-[var(--ink-6)]">{t('web.farmer.heldOnAccept', 'held safely for you when you accept')}</div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={() => decline.mutate(o.id)}
                    disabled={deciding}
                    aria-busy={(decline.isPending && decline.variables === o.id) || undefined}
                  >
                    <BusyLabel
                      busy={decline.isPending && decline.variables === o.id}
                      label={t('web.farmer.decline', 'Decline')}
                      busyLabel={t('web.farmer.declining', 'Declining…')}
                    />
                  </button>
                  <button
                    type="button"
                    className={btnCls}
                    onClick={() => accept.mutate(o.id)}
                    disabled={deciding}
                    aria-busy={(accept.isPending && accept.variables === o.id) || undefined}
                  >
                    <BusyLabel
                      busy={accept.isPending && accept.variables === o.id}
                      label={t('web.farmer.accept', 'Accept offer')}
                      busyLabel={t('web.farmer.accepting', 'Accepting…')}
                    />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        </section>

        {/* Live contracts */}
        {contracts.length > 0 && (
          <section className="order-4 lg:order-none">
            <h2 className="rule-double mb-4 pb-2 headline text-2xl text-[var(--ink)]">{t('web.farmer.contractsTitle', 'My contracts')}</h2>
            <div className="flex flex-col gap-2 lg:mb-5">
              {contracts.map((c) => (
                <div key={c.id} className="certificate flex flex-wrap items-center gap-4 bg-[var(--paper-lift)] p-4">
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
                      <CropMark code={c.commodityCode} className="h-5 w-5 text-[var(--ink-7)]" />
                      {c.quantityKg}kg {c.commodityName}
                      {c.finalGrade && <GradeBadge grade={c.finalGrade} />}
                      <StateBadge state={c.state} />
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                      {c.buyerName} · {shortDate(c.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="serial text-lg font-bold text-[var(--gold-deep)]">
                      {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                    </div>
                    <div className="text-xs text-[var(--ink-6)]">
                      {c.finalAmount !== null ? t('web.farmer.paidToYou', 'paid to you') : t('web.farmer.heldForYou', 'held for you')}
                    </div>
                  </div>
                  {c.state === 'FUNDS_HELD' && (
                    <button
                      type="button"
                      aria-busy={(suggest.isPending && suggest.variables === c.id) || undefined}
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-[var(--ink)] transition-[background-color,scale] lg:min-h-8 ${
                        suggested.has(c.id)
                          ? 'border-transparent bg-[var(--gold-wash)]'
                          : 'border-[var(--ink-5)] not-disabled:hover:bg-[var(--paper-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--paper-deep)]'
                      }`}
                      disabled={suggested.has(c.id) || (suggest.isPending && suggest.variables === c.id)}
                      onClick={() => suggest.mutate(c.id)}
                      title="Ask the buyer to send a driver — they approve and the fee escrows from their account"
                    >
                      <BusyLabel busy={suggest.isPending && suggest.variables === c.id} label={suggested.has(c.id) ? 'Buyer asked to approve' : 'Arrange delivery'} />
                    </button>
                  )}
                  <Link to={`/deals/${c.id}`} className={pillCls}>
                    {t('web.farmer.openSale', 'Open')}
                  </Link>
                  <Link to={`/t/${c.lotId}`} className={`${textLinkCls} ${hitAreaCls} text-xs font-semibold text-[var(--gold-deep)]`}>
                    Trace
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* My listings */}
        <section className="order-5 lg:order-none">
        <h2 className="rule-double mb-4 pb-2 headline text-2xl text-[var(--ink)]">{t('web.farmer.listingsTitle', 'My active listings')}</h2>
        <div className="flex flex-col gap-2 lg:mb-5">
          {lots.filter((l) => ['registered', 'matched'].includes(l.status)).length === 0 ? (
            <EmptyState
              compact
              icon={<CropMark code="MAIZE" className="h-6 w-6" />}
              title={t('web.farmer.noLotsTitle', 'Nothing on the market yet')}
              body={t(
                'web.farmer.noLotsBody',
                'Use the form to list what you have. You can also dial *384*7247# from any phone.',
              )}
            />
          ) : (
            lots
              .filter((l) => ['registered', 'matched'].includes(l.status))
              .map((l) => (
                <div key={l.id} className="certificate flex flex-wrap items-center gap-4 bg-[var(--paper-lift)] p-4">
                  {l.photoUrl ?? cropPhoto(l.commodityCode) ? (
                    <span className="block h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl">
                      <img
                        src={l.photoUrl ?? cropPhoto(l.commodityCode)!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ) : (
                    <span
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
                      style={{ background: cropAccent(l.commodityCode).wash, color: cropAccent(l.commodityCode).ink }}
                    >
                      <CropMark code={l.commodityCode} className="h-7 w-7" />
                    </span>
                  )}
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--ink)]">{l.commodityName}</span>
                      <GradeBadge grade={l.declaredBand} />
                      <StateBadge state={l.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                      {l.remainingKg === l.quantityKg
                        ? t('web.farmer.kgListed', '{kg} kg listed', { kg: l.quantityKg })
                        : t('web.farmer.kgLeft', '{left} of {kg} kg left', { left: l.remainingKg, kg: l.quantityKg })}
                      {' · '}
                      {l.bids === 0
                        ? t('web.farmer.noBids', 'no offers yet')
                        : l.bids === 1
                          ? t('web.farmer.oneBid', '1 offer')
                          : t('web.farmer.bids', '{n} offers', { n: l.bids })}
                    </div>
                  </div>
                  <div className="text-right">
                    {l.askingPricePerKg !== null ? (
                      <>
                        <div className="serial text-lg font-bold text-[var(--gold-deep)]">{ghs(l.askingPricePerKg)}</div>
                        <div className="text-xs text-[var(--ink-6)]">{t('web.farmer.yourPrice', 'your price per kg')}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-semibold text-[var(--ink)]">{t('web.farmer.marketPrice', 'Market price')}</div>
                        <div className="text-xs text-[var(--ink-6)]">{t('web.farmer.noAsk', 'no asking price set')}</div>
                      </>
                    )}
                  </div>
                  <span className="serial text-[11px] text-[var(--ink-6)]">{l.lotCode}</span>
                  <RemoveListing lotId={l.id} />
                </div>
              ))
          )}
        </div>
        </section>

        {/* Payout history */}
        <section className="order-7 lg:order-none">
        <h2 className="rule-double mb-4 pb-2 headline text-2xl text-[var(--ink)]">{t('web.farmer.payoutsTitle', 'Payout history')}</h2>
        <div className={payouts.length === 0 ? '' : 'certificate overflow-hidden bg-[var(--paper-lift)] p-3'}>
          {payouts.length === 0 ? (
            <EmptyState
              compact
              icon={<Glyph name="check" className="h-5 w-5" />}
              title={t('web.farmer.noPayoutsTitle', 'No payouts yet')}
              body={t(
                'web.farmer.noPayoutsBody',
                'When a sale is complete, the money goes to your mobile money number {momo} and shows here.',
                { momo: profile.momoMsisdn },
              )}
            />
          ) : (
            <>
            <ul className="divide-y divide-[var(--ink-1)] sm:hidden">
              {payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-2 py-3">
                  <div className="min-w-0">
                    <div className="serial text-base font-bold text-[var(--gold-deep)]">{ghs(p.amount)}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--ink-6)]">
                      {p.lotCode} · {shortDate(p.createdAt)} · {p.counterpartyMsisdn}
                    </div>
                  </div>
                  <StateBadge state={p.status} />
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
            <TableScroll minWidth={520}>
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Lot №</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>MoMo</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} serial text-xs font-bold`}>{p.lotCode}</td>
                    <td className={`${tdCls} ${numCls} font-bold text-[var(--gold-deep)]`}>{ghs(p.amount)}</td>
                    <td className={`${tdCls} serial text-xs text-[var(--ink-6)]`}>{p.counterpartyMsisdn}</td>
                    <td className={`${tdCls} text-xs text-[var(--ink-6)]`}>{shortDate(p.createdAt)}</td>
                    <td className={tdCls}>
                      <StateBadge state={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
            </div>
            </>
          )}
        </div>
        </section>
      </div>
    </div>
    </>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type PriceTerms, type Registries } from '../api';
import { useT } from '../lib/i18n';
import { AiRequestBox, type RequestFields } from './AiRequestBox';
import { PriceHint } from './PriceHint';
import {
  affixInputCls,
  affixTextCls,
  affixWrapCls,
  btnCls,
  btnGhostCls,
  BusyLabel,
  Card,
  ErrorStamp,
  FieldError,
  FieldSet,
  fieldAria,
  fieldCls,
  FormField,
  GradeBadge,
  RadioCard,
} from './ui';

const MULTIPLIERS: Record<'A' | 'B' | 'C', number> = { A: 1.0, B: 0.88, C: 0.7 };
const BANDS = ['A', 'B', 'C'] as const;
type Band = (typeof BANDS)[number];

export interface DemandPrefill {
  commodityCode?: string;
  unitCode?: string;
  unitQty?: number;
  minBand?: 'A' | 'B' | 'C';
  basePriceGhs?: string;
}

type DemandField = 'qty' | 'price' | 'termA' | 'termB' | 'termC' | 'start' | 'end';

export function NewDemandForm({
  registries,
  onDone,
  onCancel,
  initial,
}: {
  registries: Registries;
  onDone: () => void;
  onCancel?: () => void;
  initial?: DemandPrefill;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  // Two of these can be open on one page (a bid sheet over the orders list),
  // so every id is scoped to this instance.
  const uid = useId();
  const ids: Record<DemandField | 'crop' | 'unit' | 'region' | 'kg', string> = {
    crop: `${uid}-crop`,
    qty: `${uid}-qty`,
    unit: `${uid}-unit`,
    kg: `${uid}-kg`,
    price: `${uid}-price`,
    termA: `${uid}-termA`,
    termB: `${uid}-termB`,
    termC: `${uid}-termC`,
    start: `${uid}-start`,
    end: `${uid}-end`,
    region: `${uid}-region`,
  };
  const [commodityCode, setCommodityCode] = useState(initial?.commodityCode ?? registries.commodities[0]?.code ?? '');
  const commodity = registries.commodities.find((c) => c.code === commodityCode);
  const [unitCode, setUnitCode] = useState(initial?.unitCode ?? '');
  const [unitQty, setUnitQty] = useState(String(initial?.unitQty ?? 10));
  const [minBand, setMinBand] = useState<'A' | 'B' | 'C'>(initial?.minBand ?? 'B');
  const [basePrice, setBasePrice] = useState(initial?.basePriceGhs ?? '4.00'); // GHS/kg
  const [terms, setTerms] = useState<Partial<Record<'A' | 'B' | 'C', string>>>({});
  const [windowStart, setWindowStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [windowEnd, setWindowEnd] = useState(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [regionCode, setRegionCode] = useState('GREATER_ACCRA');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DemandField, string>>>({});
  // A ref as well as isPending: two taps inside one frame both see isPending=false.
  const sending = useRef(false);

  const units = commodity?.units ?? [];
  const activeUnit = units.find((u) => u.code === unitCode) ?? units[0];

  // A perishable's clock caps the window (end date is inclusive) — snap the
  // end date down whenever the chosen commodity can't reach the current one.
  useEffect(() => {
    if (!commodity) return;
    const maxDays = commodity.clock.maxWindowDays;
    const start = new Date(windowStart).getTime();
    const end = new Date(windowEnd).getTime();
    const lastAllowed = start + (maxDays - 1) * 86400000;
    if (Number.isFinite(start) && Number.isFinite(end) && end > lastAllowed) {
      setWindowEnd(new Date(lastAllowed).toISOString().slice(0, 10));
    }
  }, [commodity, windowStart, windowEnd]);

  // Per-band schedule: derived from the base price via multipliers, each band editable.
  const derived = useMemo(() => {
    const base = Math.round(Number(basePrice) * 100) || 0;
    const out: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 };
    for (const band of ['A', 'B', 'C'] as const) {
      const override = terms[band];
      out[band] =
        override !== undefined && override !== ''
          ? Math.round(Number(override) * 100)
          : Math.round((base * MULTIPLIERS[band]) / MULTIPLIERS[minBand]);
    }
    return out;
  }, [basePrice, terms, minBand]);

  const create = useMutation({
    mutationFn: () => {
      const priceTerms: PriceTerms = { ...derived, REJECT: 0 };
      return api('/api/demands', {
        method: 'POST',
        body: JSON.stringify({
          commodityCode,
          unitCode: activeUnit?.code,
          unitQty: Number(unitQty),
          minBand,
          priceTerms,
          windowStart: new Date(windowStart).getTime(),
          windowEnd: new Date(windowEnd).getTime() + 86399000, // end of day
          regionCode,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demands'] });
      onDone();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t('web.demandForm.failed', 'Could not post your request. Check your connection and try again.')),
  });

  const kg = activeUnit ? Math.round(activeUnit.kgPerUnit * Number(unitQty) * 10) / 10 : 0;

  // The latest last day a perishable allows, for the date picker's max.
  const lastAllowedDay = (() => {
    if (!commodity) return undefined;
    const start = new Date(windowStart).getTime();
    if (!Number.isFinite(start)) return undefined;
    return new Date(start + (commodity.clock.maxWindowDays - 1) * 86400000).toISOString().slice(0, 10);
  })();

  type Values = { unitQty: string; basePrice: string; terms: typeof terms; windowStart: string; windowEnd: string };
  const values: Values = { unitQty, basePrice, terms, windowStart, windowEnd };

  function check(field: DemandField, v: Values): string | undefined {
    switch (field) {
      case 'qty': {
        if (!v.unitQty.trim()) return t('web.demandForm.qtyMissing', 'Enter how many you need, like 10.');
        const n = Number(v.unitQty);
        return Number.isFinite(n) && n > 0 ? undefined : t('web.demandForm.qtyInvalid', 'Enter a number above 0, like 10.');
      }
      case 'price': {
        if (!v.basePrice.trim()) return t('web.demandForm.priceMissing', 'Enter your price per kg, like 4.50.');
        const n = Number(v.basePrice);
        return Number.isFinite(n) && n > 0 ? undefined : t('web.demandForm.priceInvalid', 'Enter a price above 0 in numbers only, like 4.50.');
      }
      case 'termA':
      case 'termB':
      case 'termC': {
        const raw = v.terms[field.slice(4) as Band];
        if (raw === undefined || raw === '') return undefined;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? undefined : t('web.demandForm.termInvalid', 'Enter a price in numbers only, like 3.50.');
      }
      case 'start':
        return v.windowStart ? undefined : t('web.demandForm.startMissing', 'Choose the first day you can take delivery.');
      case 'end':
        if (!v.windowEnd) return t('web.demandForm.endMissing', 'Choose the last day you can take delivery.');
        if (v.windowStart && v.windowEnd < v.windowStart)
          return t('web.demandForm.endBeforeStart', 'The last day must be on or after the first day.');
        return undefined;
    }
  }

  const ORDER: DemandField[] = ['qty', 'price', 'termA', 'termB', 'termC', 'start', 'end'];

  // While typing: never add an error, only take one away once it is fixed.
  function clearFixed(next: Values) {
    setErrors((cur) => {
      const out = { ...cur };
      for (const f of Object.keys(cur) as DemandField[]) if (cur[f] && !check(f, next)) delete out[f];
      return out;
    });
  }

  function blurCheck(field: DemandField, hasValue: boolean) {
    if (!hasValue && !errors[field]) return;
    const message = check(field, values);
    setErrors((cur) => ({ ...cur, [field]: message }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || create.isPending) return;
    const found: Partial<Record<DemandField, string>> = {};
    for (const f of ORDER) {
      const message = check(f, values);
      if (message) found[f] = message;
    }
    setErrors(found);
    const first = ORDER.find((f) => found[f]);
    if (first) {
      document.getElementById(ids[first])?.focus();
      return;
    }
    setError(null);
    sending.current = true;
    create.mutate(undefined, {
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  /** Take what the assist read from the buyer's words into the form. The buyer still reviews and posts it. */
  function applyFields(f: RequestFields) {
    const crop = f.commodityCode ? registries.commodities.find((c) => c.code === f.commodityCode) : commodity;
    if (f.commodityCode && crop) {
      setCommodityCode(crop.code);
      setUnitCode(f.unitCode ?? '');
    }
    const cropUnits = crop?.units ?? [];
    if (f.unitQty !== undefined) setUnitQty(String(f.unitQty));
    else if (f.quantityKg !== undefined && cropUnits.length > 0) {
      // A weight becomes a count of the crop's usual unit (its biggest formal one), rounded — shown for the buyer to adjust.
      const unit = [...cropUnits].filter((u) => !u.isInformal).sort((a, b) => b.kgPerUnit - a.kgPerUnit)[0] ?? cropUnits[0]!;
      setUnitCode(unit.code);
      setUnitQty(String(Math.max(1, Math.round(f.quantityKg / unit.kgPerUnit))));
    }
    if (f.pricePerKgGhs !== undefined) setBasePrice(String(f.pricePerKgGhs));
    if (f.minBand) setMinBand(f.minBand);
    if (f.regionCode) setRegionCode(f.regionCode);
    if (f.windowDays !== undefined) setWindowEnd(new Date(Date.now() + f.windowDays * 86400000).toISOString().slice(0, 10));
    setErrors({});
  }

  // Static keys, so i18n:extract finds every one.
  const minText: Record<Band, { title: string; detail: string }> = {
    A: { title: t('web.demandForm.minATitle', 'Best only'), detail: t('web.demandForm.minADetail', 'Grade A produce only') },
    B: { title: t('web.demandForm.minBTitle', 'Good or better'), detail: t('web.demandForm.minBDetail', 'Grade A or B') },
    C: { title: t('web.demandForm.minCTitle', 'Fair or better'), detail: t('web.demandForm.minCDetail', 'Grade A, B or C') },
  };
  const termLabel: Record<Band, string> = {
    A: t('web.demandForm.termA', 'Grade A'),
    B: t('web.demandForm.termB', 'Grade B'),
    C: t('web.demandForm.termC', 'Grade C'),
  };

  return (
    // The dialog that holds this form already names it (Orders, the bid sheet).
    <Card>
      <form noValidate onSubmit={submit} aria-busy={create.isPending} className="flex flex-col gap-5">
        <AiRequestBox onFields={applyFields} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={ids.crop} label={t('web.demandForm.cropLabel', 'Crop')}>
            <select
              id={ids.crop}
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
                  {c.clockType === 'perishable' ? ` · ${t('web.demandForm.perishableTag', 'perishable')}` : ''}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset className="m-0 min-w-0 border-0 p-0 text-sm">
            <legend className="smallcaps mb-1.5 p-0 text-[var(--ink-6)]">{t('web.demandForm.qtyLegend', 'How much you need')}</legend>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              <input
                {...fieldAria(ids.qty, errors.qty, ids.kg)}
                aria-label={t('web.demandForm.qtyNumber', 'How many')}
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
                  clearFixed({ ...values, unitQty: v });
                }}
                onBlur={() => blurCheck('qty', !!unitQty)}
              />
              <select
                id={ids.unit}
                name="unit"
                aria-label={t('web.demandForm.unitLabel', 'Unit')}
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
            <FieldError id={`${ids.qty}-error`} message={errors.qty} />
            <p id={ids.kg} className="serial mt-1.5 text-sm font-semibold text-[var(--ink-7)]">
              {Number.isFinite(kg) && kg > 0 ? t('web.demandForm.kgTotal', '= {kg} kg in total', { kg: kg.toLocaleString('en-GH') }) : null}
            </p>
          </fieldset>

          <FieldSet
            id={`${uid}-grade`}
            className="sm:col-span-2"
            legend={t('web.demandForm.gradeLegend', 'Lowest grade you will take')}
          >
            <div className="grid gap-2 md:grid-cols-3">
              {BANDS.map((g) => (
                <RadioCard
                  key={g}
                  name={`${uid}-minBand`}
                  value={g}
                  checked={minBand === g}
                  onChange={() => setMinBand(g)}
                  icon={<GradeBadge grade={g} />}
                  title={minText[g].title}
                  detail={minText[g].detail}
                />
              ))}
            </div>
          </FieldSet>

          <FormField
            id={ids.price}
            label={t('web.demandForm.priceLabel', 'Your price for grade {band}', { band: minBand })}
            error={errors.price}
            hint={t('web.demandForm.priceHint', 'The other grades are worked out from this below. You can change them.')}
          >
            <div className={affixWrapCls}>
              <span id={`${ids.price}-pre`} className={`${affixTextCls} pl-3 font-semibold`}>
                GHS
              </span>
              <input
                {...fieldAria(ids.price, errors.price, `${ids.price}-pre`, `${ids.price}-per`, `${ids.price}-hint`)}
                className={affixInputCls}
                type="text"
                inputMode="decimal"
                name="price"
                autoComplete="off"
                spellCheck={false}
                value={basePrice}
                onChange={(e) => {
                  const v = e.target.value.replace(/\s+/g, '');
                  setBasePrice(v);
                  clearFixed({ ...values, basePrice: v });
                }}
                onBlur={() => blurCheck('price', !!basePrice)}
              />
              <span id={`${ids.price}-per`} className={`${affixTextCls} pr-3`}>
                {t('web.demandForm.perKg', 'per kg')}
              </span>
            </div>
            <PriceHint
              commodityCode={commodityCode}
              regionCode={regionCode}
              price={basePrice.trim() && Number(basePrice) > 0 ? Math.round(Number(basePrice) * 100) : null}
              side="buy"
            />
          </FormField>

          <FormField id={ids.region} label={t('web.demandForm.regionLabel', 'Deliver to')}>
            <select id={ids.region} name="region" className={fieldCls} value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
              {registries.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id={ids.start} label={t('web.demandForm.startLabel', 'From')} error={errors.start}>
            <input
              {...fieldAria(ids.start, errors.start)}
              className={fieldCls}
              type="date"
              name="window-start"
              value={windowStart}
              onChange={(e) => {
                setWindowStart(e.target.value);
                clearFixed({ ...values, windowStart: e.target.value });
              }}
              onBlur={() => blurCheck('start', true)}
            />
          </FormField>

          <FormField
            id={ids.end}
            label={t('web.demandForm.endLabel', 'Until')}
            error={errors.end}
            hint={
              commodity?.clockType === 'perishable'
                ? t('web.demandForm.perishableHint', 'Perishable: the window can be at most {days} days.', {
                    days: commodity.clock.maxWindowDays,
                  })
                : undefined
            }
          >
            <input
              {...fieldAria(ids.end, errors.end, commodity?.clockType === 'perishable' && `${ids.end}-hint`)}
              className={fieldCls}
              type="date"
              name="window-end"
              min={windowStart || undefined}
              max={lastAllowedDay}
              value={windowEnd}
              onChange={(e) => {
                setWindowEnd(e.target.value);
                clearFixed({ ...values, windowEnd: e.target.value });
              }}
              onBlur={() => blurCheck('end', true)}
            />
          </FormField>
        </div>

        <fieldset
          aria-describedby={`${uid}-terms-note`}
          className="certificate m-0 min-w-0 border-0 bg-[var(--paper)] p-4 text-sm"
        >
          <legend className="smallcaps float-left mb-1 w-full p-0 text-[var(--ink-6)]">
            {t('web.demandForm.termsLegend', 'Price for each grade')}
          </legend>
          <p id={`${uid}-terms-note`} className="clear-both mb-3 text-xs leading-snug text-[var(--ink-6)]">
            {t('web.demandForm.termsNote', 'The farmer accepts this full list. Produce graded as rejected is paid 0.')}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {BANDS.map((band) => {
              const field = `term${band}` as const;
              return (
                <div key={band}>
                  <label htmlFor={ids[field]} className="mb-1.5 flex items-center gap-2 font-semibold text-[var(--ink)]">
                    <span aria-hidden="true">
                      <GradeBadge grade={band} />
                    </span>
                    {termLabel[band]}
                  </label>
                  <div className={affixWrapCls}>
                    <span id={`${ids[field]}-pre`} className={`${affixTextCls} pl-3 font-semibold`}>
                      GHS
                    </span>
                    <input
                      {...fieldAria(ids[field], errors[field], `${ids[field]}-pre`, `${ids[field]}-per`)}
                      className={affixInputCls}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={terms[band] ?? (derived[band] / 100).toFixed(2)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\s+/g, '');
                        const next = { ...terms, [band]: v };
                        setTerms(next);
                        clearFixed({ ...values, terms: next });
                      }}
                      onBlur={() => {
                        // An emptied box goes back to the worked-out price instead of sitting blank.
                        if (terms[band] === '') {
                          setTerms((cur) => {
                            const out = { ...cur };
                            delete out[band];
                            return out;
                          });
                          return;
                        }
                        blurCheck(field, true);
                      }}
                    />
                    <span id={`${ids[field]}-per`} className={`${affixTextCls} pr-3`}>
                      {t('web.demandForm.perKg', 'per kg')}
                    </span>
                  </div>
                  <FieldError id={`${ids[field]}-error`} message={errors[field]} />
                </div>
              );
            })}
          </div>
        </fieldset>

        {error && <ErrorStamp message={error} onDismiss={() => setError(null)} />}
        <div className="flex gap-3">
          <button
            type="submit"
            className={`${btnCls} flex-1 py-2.5`}
            aria-disabled={create.isPending || undefined}
            aria-busy={create.isPending || undefined}
          >
            <BusyLabel busy={create.isPending} label={t('web.demandForm.submit', 'Post request')} busyLabel={t('web.demandForm.submitting', 'Posting…')} />
          </button>
          <button type="button" className={`${btnGhostCls} flex-1 py-2.5`} onClick={onCancel ?? onDone}>
            {t('web.demandForm.cancel', 'Cancel')}
          </button>
        </div>
      </form>
    </Card>
  );
}

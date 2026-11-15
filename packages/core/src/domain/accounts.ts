import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, type Account } from '../db/schema';
import { getBuyerById, getBuyerByPhone, registerBuyer } from './buyers';
import { getDriverById, getDriverByPhone, registerDriver } from './drivers';
import { DomainError } from './errors';
import { getFarmerById, getFarmerByPhone, normalizePhone, registerFarmer } from './farmers';

/**
 * Web accounts (D-047). Supabase proves who is logging in (phone + password);
 * an account row ties that login to the ONE F2M role the phone holds. A phone
 * that already registered by USSD is linked rather than duplicated, so a
 * farmer who lists by USSD and later opens the web sees the same lots.
 *
 * The phone always comes from the verified login, never from a form, so
 * nobody can sign up with their own password and claim another person's
 * number. Until SMS confirmation is on, Supabase cannot prove the person owns
 * that number; the invite list in supabase/migrations is what stands in for it.
 */
export type AccountRole = Account['role'];

export interface RegisterAccountInput {
  authUserId: string;
  /** From the verified login token — not user input. */
  phone: string;
  role: AccountRole;
  name: string;
  regionCode: string;
  district?: string;
  company?: string; // buyers
  vehicleClassCode?: string; // drivers
  locale?: string;
}

export async function getAccountByAuthUser(authUserId: string): Promise<Account | undefined> {
  return (await db.select().from(accounts).where(eq(accounts.authUserId, authUserId)))[0];
}

/** The id of the farmer, buyer or driver row this account acts as. */
export function accountRoleId(account: Account): string {
  const id = account.role === 'farmer' ? account.farmerId : account.role === 'buyer' ? account.buyerId : account.driverId;
  if (!id) throw new DomainError('This account is not linked to a profile', 'ACCOUNT_BROKEN', 500);
  return id;
}

export async function registerAccount(input: RegisterAccountInput): Promise<Account> {
  const phone = normalizePhone(input.phone);
  if (await getAccountByAuthUser(input.authUserId)) {
    throw new DomainError('This login already has an F2M profile', 'ACCOUNT_EXISTS', 409);
  }
  if ((await db.select().from(accounts).where(eq(accounts.phone, phone)))[0]) {
    throw new DomainError('This phone number already has an F2M account', 'PHONE_TAKEN', 409);
  }

  // One role per phone (D-021), across USSD and the web alike.
  const farmer = await getFarmerByPhone(phone);
  const driver = await getDriverByPhone(phone);
  const buyer = await getBuyerByPhone(phone);
  const heldAs = farmer ? 'farmer' : driver ? 'driver' : buyer ? 'buyer' : null;
  if (heldAs && heldAs !== input.role) {
    throw new DomainError(`This phone number is already registered as a ${heldAs}`, 'ROLE_TAKEN', 409);
  }

  return db.transaction(async () => {
    let farmerId: string | null = null;
    let buyerId: string | null = null;
    let driverId: string | null = null;
    if (input.role === 'farmer') {
      farmerId =
        farmer?.id ??
        (await registerFarmer({ phone, name: input.name, regionCode: input.regionCode, district: input.district, locale: input.locale })).id;
    } else if (input.role === 'driver') {
      if (!driver && !input.vehicleClassCode) throw new DomainError('Choose your vehicle', 'VEHICLE_REQUIRED');
      driverId =
        driver?.id ??
        (await registerDriver({
                    phone,
                    name: input.name,
                    regionCode: input.regionCode,
                    vehicleClassCode: input.vehicleClassCode!,
                    locale: input.locale,
                  })).id;
    } else {
      buyerId = buyer?.id ?? (await registerBuyer({ phone, name: input.name, company: input.company, regionCode: input.regionCode })).id;
    }
    return (await db
              .insert(accounts)
              .values({ authUserId: input.authUserId, phone, role: input.role, farmerId, buyerId, driverId })
              .returning())[0]!;
  });
}

/** What the web shows about the signed-in person. */
export interface AccountView {
  role: AccountRole;
  id: string;
  phone: string;
  name: string;
  regionCode: string | null;
  company: string | null;
  vehicleClassCode: string | null;
}

export async function describeAccount(account: Account): Promise<AccountView> {
  const id = accountRoleId(account);
  const base = { role: account.role, id, phone: account.phone, company: null, vehicleClassCode: null };
  if (account.role === 'farmer') {
    const f = await getFarmerById(id);
    return { ...base, name: f?.name ?? '', regionCode: f?.regionCode ?? null };
  }
  if (account.role === 'driver') {
    const d = await getDriverById(id);
    return { ...base, name: d?.name ?? '', regionCode: d?.regionCode ?? null, vehicleClassCode: d?.vehicleClassCode ?? null };
  }
  const b = await getBuyerById(id);
  return { ...base, name: b?.name ?? '', regionCode: b?.regionCode ?? null, company: b?.company ?? null };
}

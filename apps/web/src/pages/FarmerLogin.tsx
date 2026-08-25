import { RoleLogin } from '../components/RoleLogin';

/** Farmer web login (D-032): phone → one-time code over SMS, one tab of the shared role card. */
export function FarmerLoginPage() {
  return <RoleLogin initialRole="farmer" />;
}

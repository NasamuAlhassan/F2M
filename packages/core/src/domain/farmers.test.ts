import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { registerFarmer, updateFarmerProfile } from './farmers';
import { registerLot } from './lots';
import { listNotificationsForPhone } from './notifications';

describe('farmer profile + listing receipts (M30, D-040)', () => {
  it('registration queues the sms.registered receipt in the chosen locale', () => {
    const farmer = registerFarmer({ phone: '+233209990501', name: 'Receipt One', regionCode: 'NORTHERN', locale: 'tw' });
    expect(farmer.locale).toBe('tw');
    const inbox = listNotificationsForPhone(farmer.phone);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.templateKey).toBe('sms.registered');
    // Gate closed + tw catalog has no sms.registered → honest English text.
    expect(inbox[0]!.message).toContain('Welcome Receipt One!');
    expect(inbox[0]!.message).toContain('*384*7247#');
  });

  it('a USSD lot queues sms.lotListed; a web lot does not (the dashboard is the record)', () => {
    const farmer = registerFarmer({ phone: '+233209990502', name: 'Receipt Two', regionCode: 'NORTHERN' });
    registerLot({ farmerId: farmer.id, commodityCode: 'MAIZE', unitCode: 'BAG_50KG', unitQty: 4, declaredBand: 'B' });
    let receipts = listNotificationsForPhone(farmer.phone).filter((n) => n.templateKey === 'sms.lotListed');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.message).toContain('4 50kg bag of Maize');

    registerLot({
      farmerId: farmer.id,
      commodityCode: 'MAIZE',
      unitCode: 'BAG_50KG',
      unitQty: 2,
      declaredBand: 'B',
      channel: 'web',
    });
    receipts = listNotificationsForPhone(farmer.phone).filter((n) => n.templateKey === 'sms.lotListed');
    expect(receipts).toHaveLength(1); // unchanged — web sellers get no SMS receipt
  });

  it('updateFarmerProfile sets a valid locale and refuses an unknown one', () => {
    const farmer = registerFarmer({ phone: '+233209990503', name: 'Locale Three', regionCode: 'NORTHERN' });
    expect(updateFarmerProfile(farmer.id, { locale: 'dag' }).locale).toBe('dag');
    expect(updateFarmerProfile(farmer.id, {}).locale).toBe('dag'); // no-op keeps it
    expect(() => updateFarmerProfile(farmer.id, { locale: 'xx' })).toThrow(DomainError);
    expect(() => registerFarmer({ phone: '+233209990504', name: 'Bad', regionCode: 'NORTHERN', locale: 'zz' })).toThrow(
      /Unknown locale/,
    );
  });
});

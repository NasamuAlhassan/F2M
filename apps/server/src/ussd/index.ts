import { registerScreens } from './machine';
import {
  driverActive,
  driverHome,
  driverOfferDetail,
  driverOffers,
  driverPayments,
  driverRegConfirm,
  driverRegName,
  driverRegPin,
  driverRegRegion,
  driverRegVehicle,
} from './screens/driver';
import { home } from './screens/home';
import { langSettings, langWelcome } from './screens/language';
import { lotDetail, lotEditPrice, lotEditQty, lotEditReady, lotSoldConfirm, lotsList, lotWithdrawConfirm } from './screens/lots';
import { offerCounterConfirm, offerCounterPrice, offerCounterUnits, offerDetail, offersList } from './screens/offers';
import { requestConfirm, requestDetail, requestPickLot, requestPrice, requestsList, requestUnits } from './screens/requests';
import { paymentsScreen } from './screens/payments';
import { pricesCommodity, pricesShow } from './screens/prices';
import { regConfirm, regDistrict, regName, regRegion, welcome } from './screens/register';
import { sellBand, sellCommodity, sellConfirm, sellPrice, sellQty, sellReady, sellUnit } from './screens/sell';

registerScreens(
  langWelcome,
  langSettings,
  welcome,
  regName,
  regRegion,
  regDistrict,
  regConfirm,
  home,
  sellCommodity,
  sellUnit,
  sellQty,
  sellBand,
  sellReady,
  sellPrice,
  sellConfirm,
  lotsList,
  lotDetail,
  lotWithdrawConfirm,
  lotEditPrice,
  lotEditQty,
  lotSoldConfirm,
  lotEditReady,
  offersList,
  offerDetail,
  offerCounterPrice,
  offerCounterUnits,
  offerCounterConfirm,
  requestsList,
  requestDetail,
  requestPickLot,
  requestUnits,
  requestPrice,
  requestConfirm,
  paymentsScreen,
  pricesCommodity,
  pricesShow,
  driverRegName,
  driverRegRegion,
  driverRegVehicle,
  driverRegPin,
  driverRegConfirm,
  driverHome,
  driverOffers,
  driverOfferDetail,
  driverActive,
  driverPayments,
);

export { handleUssdRequest } from './machine';

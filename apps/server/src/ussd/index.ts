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
import { lotDetail, lotsList } from './screens/lots';
import { offerDetail, offersList } from './screens/offers';
import { paymentsScreen } from './screens/payments';
import { pricesCommodity, pricesShow } from './screens/prices';
import { regConfirm, regDistrict, regName, regRegion, welcome } from './screens/register';
import { sellBand, sellCommodity, sellConfirm, sellQty, sellReady, sellUnit } from './screens/sell';

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
  sellConfirm,
  lotsList,
  lotDetail,
  offersList,
  offerDetail,
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

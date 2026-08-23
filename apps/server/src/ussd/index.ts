import { registerScreens } from './machine';
import { home } from './screens/home';
import { lotDetail, lotsList } from './screens/lots';
import { offerDetail, offersList } from './screens/offers';
import { paymentsScreen } from './screens/payments';
import { regConfirm, regDistrict, regName, regRegion, welcome } from './screens/register';
import { sellBand, sellCommodity, sellConfirm, sellQty, sellReady, sellUnit } from './screens/sell';

registerScreens(
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
);

export { handleUssdRequest } from './machine';

import { registerFlow } from './machine';
import { bidFlow } from './flows/bid';
import { bridgeFlow } from './flows/bridge';
import { gradeFlow } from './flows/grade';
import { lineFlow } from './flows/line';
import { listingFlow } from './flows/listing';
import { offerFlow } from './flows/offer';

registerFlow('offer', offerFlow);
registerFlow('grade', gradeFlow);
registerFlow('bridge', bridgeFlow);
registerFlow('bid', bidFlow);
// Phase 2: a guided listing (F2M calls back from USSD), and the listing line's
// menu. Nodes are shared, so the line hands over to the listing and offer steps.
registerFlow('listing', listingFlow);
registerFlow('line', lineFlow);

export { handleVoiceAnswer } from './machine';

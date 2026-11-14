import { registerFlow } from './machine';
import { bidFlow } from './flows/bid';
import { bridgeFlow } from './flows/bridge';
import { gradeFlow } from './flows/grade';
import { offerFlow } from './flows/offer';

registerFlow('offer', offerFlow);
registerFlow('grade', gradeFlow);
registerFlow('bridge', bridgeFlow);
registerFlow('bid', bidFlow);

export { handleVoiceAnswer } from './machine';

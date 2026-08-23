import { registerFlow } from './machine';
import { bridgeFlow } from './flows/bridge';
import { gradeFlow } from './flows/grade';
import { offerFlow } from './flows/offer';

registerFlow('offer', offerFlow);
registerFlow('grade', gradeFlow);
registerFlow('bridge', bridgeFlow);

export { handleVoiceAnswer } from './machine';

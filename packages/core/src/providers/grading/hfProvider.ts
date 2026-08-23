import { config } from '../../config';
import { extractJson } from './extractJson';
import { modelOutputSchema, type GradingProvider, type GradingRequest, type GradingResult } from './types';

const ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

/**
 * Free vision models via HuggingFace's OpenAI-compatible router (D-006).
 * Pipeline: prompt embeds the rubric verbatim → strict JSON extraction → Zod
 * validation bound to the rubric → one repair round-trip on invalid JSON →
 * exponential backoff on 429/503. Throws when exhausted; the grading flow
 * falls back to the mock provider so a cold model never kills a demo.
 */
export class HfGradingProvider implements GradingProvider {
  readonly name = 'hf' as const;

  constructor(
    private readonly opts: { model?: string; token?: string; retryDelayMs?: number } = {},
  ) {}

  private get model(): string {
    return this.opts.model ?? config.GRADING_MODEL;
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    const maxAttempts = 3;
    let lastError = '';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await fetch(ROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.token ?? config.HF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, max_tokens: 800, temperature: 0.1, messages }),
      });
      if (res.ok) {
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty completion from HF router');
        return content;
      }
      lastError = `${res.status} ${await res.text()}`;
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        // Rate limit / cold model — back off and retry.
        const delay = (this.opts.retryDelayMs ?? 2000) * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break; // 4xx other than 429: retrying won't help
    }
    throw new Error(`HF router failed: ${lastError}`);
  }

  async grade(req: GradingRequest): Promise<GradingResult> {
    const schema = modelOutputSchema(req.rubric);
    const exampleReason = req.rubric.criteria[0]!;
    const systemPrompt = [
      `You are a produce quality grader for ${req.commodityCode} in a Ghanaian farm-to-market marketplace.`,
      `Grade STRICTLY against this rubric (JSON):`,
      JSON.stringify(req.rubric, null, 1),
      ``,
      `Rules:`,
      `- Assess EVERY criterion you can see evidence for; use each criterion's visualCues and bandDescriptors.`,
      `- The overall gradeBand is the WORST criterion band (aggregation: worst_criterion).`,
      `- confidence is 0..1: how clearly the photos support your call.`,
      `- Each reason's observation describes what YOU SEE in the photo, concretely.`,
      ``,
      `Respond with ONLY a JSON object, no prose, exactly this shape:`,
      JSON.stringify(
        {
          gradeBand: req.rubric.gradeBands[1] ?? 'B',
          confidence: 0.82,
          reasons: [
            {
              criterion: exampleReason.key,
              observation: 'example: surface mould visible on roughly 10% of kernels near the bag seam',
              bandForCriterion: req.rubric.gradeBands[2] ?? 'C',
            },
          ],
        },
        null,
        1,
      ),
    ].join('\n');

    const userContent: ChatMessage['content'] = [
      {
        type: 'text',
        text: `Grade this ${req.commodityCode} against the rubric. Reply with ONLY the JSON object.`,
      },
      ...req.images.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mime};base64,${img.base64}` },
      })),
    ];

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const first = await this.chat(messages);
    try {
      const parsed = schema.parse(extractJson(first));
      return { ...parsed, provider: 'hf', model: this.model, raw: first };
    } catch {
      // One repair round-trip: show the model its reply and demand valid JSON.
      const repaired = await this.chat([
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content:
            'Your last reply was not valid JSON for the required schema. Resend ONLY the JSON object — no prose, no code fences.',
        },
      ]);
      const parsed = schema.parse(extractJson(repaired));
      return { ...parsed, provider: 'hf', model: this.model, raw: repaired };
    }
  }
}

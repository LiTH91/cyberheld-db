const os = require('os');
let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  // openai not installed yet – caller should install it
}

class AIService {
  constructor(options = {}) {
    this.model = options.model || 'gpt-5-mini';
    this.maxBatchSize = Math.max(1, Math.min(options.maxBatchSize || 100, 200));
    this.openai = null;
    if (OpenAI && process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  isReady() {
    return !!this.openai;
  }

  buildSystemPrompt(customLawText) {
    const base =
      'You are a professional comment analyzer. Analyze Facebook comments. ' +
      'Classify whether a comment is negative. For negative comments, evaluate if it constitutes hatespeech, threatening, or offensive content. ' +
      'Provide a concise reasoning of 1-2 sentences (max 300 characters). ' +
      'Return a JSON object strictly matching the schema: { "results": [ { "comment_id": string, "comment": string, "is_negative": boolean, "confidence_score": number, "reasoning": string } ] }. ' +
      'Only output JSON – no extra text.';
    const law = customLawText || '';
    return `${base}${law ? `\n\nLegal framework (DE/AT reference, condensed):\n${law}` : ''}`;
  }

  chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  formatCommentsForPrompt(comments) {
    // Create short, token-cheap IDs: c1, c2, ... and map back
    const shortToReal = new Map();
    const realToShort = new Map();
    const lines = [];
    comments.forEach((c, idx) => {
      const shortId = `c${idx + 1}`;
      shortToReal.set(shortId, c.id);
      realToShort.set(c.id, shortId);
      // Simple protection against accidental prompt injection:
      const safeText = String(c.text || '').replace(/\s+/g, ' ').slice(0, 4000);
      lines.push(`ID: ${shortId}\nComment: ${safeText}`);
    });
    return { shortToReal, realToShort, promptBlock: lines.join('\n') };
  }

  parseResponseToResults(response, shortToReal) {
    try {
      // Prefer Responses API: output_text convenience when available
      const text = response?.output_text
        || (Array.isArray(response?.output) ? response.output.map(o => o?.content?.map(p => p?.text).filter(Boolean).join('\n')).filter(Boolean).join('\n') : null)
        || response?.data?.[0]?.content?.[0]?.text
        || '';
      const json = JSON.parse(text);
      const results = Array.isArray(json?.results) ? json.results : [];
      return results.map(r => ({
        comment_id: shortToReal.get(String(r.comment_id)) || r.comment_id,
        comment: r.comment,
        is_negative: !!r.is_negative,
        confidence_score: typeof r.confidence_score === 'number' ? r.confidence_score : 0,
        reasoning: r.reasoning || ''
      }));
    } catch (e) {
      return [];
    }
  }

  async analyzeComments(comments, options = {}) {
    if (!Array.isArray(comments) || comments.length === 0) return [];
    if (!this.openai) throw new Error('OpenAI client not initialized. Set OPENAI_API_KEY and install "openai".');

    const model = options.model || this.model;
    const lawText = options.lawText || null;
    const chunks = this.chunkArray(comments, Math.max(1, Math.min(options.batchSize || this.maxBatchSize, 200)));
    const all = [];

    for (const chunk of chunks) {
      const { shortToReal, promptBlock } = this.formatCommentsForPrompt(chunk);
      const developerContent = this.buildSystemPrompt(lawText);

      const input = [
        {
          role: 'developer',
          content: [ { type: 'input_text', text: developerContent } ]
        },
        {
          role: 'user',
          content: [ { type: 'input_text', text: promptBlock } ]
        }
      ];

      let response;
      try {
        response = await this.openai.responses.create({
          model,
          input,
          text: {
            format: {
              type: 'json_schema',
              name: 'comment_sentiment_analysis',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        comment_id: { type: 'string' },
                        comment: { type: 'string' },
                        is_negative: { type: 'boolean' },
                        confidence_score: { type: 'number', minimum: 0, maximum: 1 },
                        reasoning: { type: 'string', maxLength: 300, description: '1-2 sentences, concise' }
                      },
                      required: ['comment_id', 'comment', 'is_negative', 'confidence_score', 'reasoning'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['results'],
                additionalProperties: false
              }
            },
            verbosity: 'medium'
          }
        });
      } catch (err) {
        // basic backoff retry for transient errors
        await new Promise(r => setTimeout(r, 1500));
        response = await this.openai.responses.create({ model, input });
      }

      const mapped = this.parseResponseToResults(response, shortToReal);
      // Safety clamp: ensure reasoning length <= 300 chars
      for (const m of mapped) {
        if (typeof m.reasoning === 'string' && m.reasoning.length > 300) {
          m.reasoning = m.reasoning.slice(0, 300);
        }
      }
      all.push(...mapped);
    }
    return all;
  }
}

module.exports = { AIService };



const express = require('express');
const path = require('path');
const { z } = require('zod');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/', express.static(path.join(__dirname, 'public')));

const ChatReq = z.object({
  text: z.string().min(1).max(4000),
  system: z.string().max(8000).optional(),
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/chat', async (req, res) => {
  const parsed = ChatReq.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues });
  }

  const { text, system } = parsed.data;

  // If no key, return a helpful stub so the UI still works.
  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      ok: true,
      text: `（本地演示模式：未配置 OPENAI_API_KEY）你刚才说：${text}`,
      mode: 'stub',
    });
  }

  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Use Responses API (recommended). Keep it simple.
    const resp = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [
        ...(system
          ? [{ role: 'system', content: [{ type: 'input_text', text: system }] }]
          : []),
        {
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      ],
    });

    const out = resp.output_text || '';
    return res.json({ ok: true, text: out, mode: 'openai' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`web-voice-intercom listening on http://localhost:${port}`);
});

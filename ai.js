const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function env(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function buildTextAttempts() {
  const attempts = [];
  if (process.env.CEREBRAS_API_KEY) {
    attempts.push({
      provider: 'cerebras',
      url: CEREBRAS_URL,
      key: process.env.CEREBRAS_API_KEY,
      model: env('CEREBRAS_MODEL', 'gpt-oss-120b')
    });
    attempts.push({
      provider: 'cerebras',
      url: CEREBRAS_URL,
      key: process.env.CEREBRAS_API_KEY,
      model: env('CEREBRAS_MODEL_FALLBACK', 'gemma-4-31b')
    });
  }
  if (process.env.GROQ_API_KEY) {
    attempts.push({
      provider: 'groq',
      url: GROQ_URL,
      key: process.env.GROQ_API_KEY,
      model: env('GROQ_MODEL', 'llama-3.3-70b-versatile')
    });
    attempts.push({
      provider: 'groq',
      url: GROQ_URL,
      key: process.env.GROQ_API_KEY,
      model: env('GROQ_MODEL_FALLBACK', 'openai/gpt-oss-120b')
    });
  }
  return attempts;
}

function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function callChatCompletion(url, apiKey, model, messages, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`nu a raspuns in ${timeoutMs / 1000}s`);
    throw new Error(`conexiune esuata: ${err.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`${res.status}: ${errBody?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('raspuns fara continut');
  return content;
}

async function generateWithFallback(messages) {
  const attempts = buildTextAttempts();
  if (!attempts.length) {
    throw new Error('Serverul nu are configurata nicio cheie AI (CEREBRAS_API_KEY / GROQ_API_KEY in .env).');
  }
  const errors = [];
  for (const attempt of attempts) {
    try {
      const content = await callChatCompletion(attempt.url, attempt.key, attempt.model, messages);
      return { content: stripThinking(content), provider: attempt.provider, model: attempt.model };
    } catch (err) {
      errors.push(`${attempt.provider}/${attempt.model}: ${err.message}`);
    }
  }
  throw new Error(`Toate incercarile (Cerebras + Groq) au esuat. - ${errors.join(' || ')}`);
}

async function visionTranscribe(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Serverul nu are configurata cheia GROQ_API_KEY in .env (necesara pentru transcriere din poza).');
  }
  const model = env('GROQ_VISION_MODEL', 'qwen/qwen3.6-27b');
  const content = await callChatCompletion(GROQ_URL, process.env.GROQ_API_KEY, model, messages, 60000);
  return { content: stripThinking(content), provider: 'groq', model };
}

module.exports = { generateWithFallback, visionTranscribe };

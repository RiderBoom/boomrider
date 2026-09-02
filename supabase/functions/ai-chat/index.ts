import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://boomrider.vercel.app';
const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const MAX_TEXT_LENGTH = 2_000;
const MAX_PROMPT_LENGTH = 20_000;
const MAX_TOOLS_LENGTH = 20_000;
const MAX_BODY_BYTES = 50_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requestWindows = new Map<string, { count: number; resetAt: number }>();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function allowRequest(userId: string) {
  const now = Date.now();
  const current = requestWindows.get(userId);
  if (!current || current.resetAt <= now) {
    if (requestWindows.size > 10_000) {
      for (const [key, value] of requestWindows) {
        if (value.resetAt <= now) requestWindows.delete(key);
      }
    }
    requestWindows.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash';

    if (!authHeader || !supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
      return json({ error: 'AI service is not configured' }, 503);
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    if (!allowRequest(user.id)) return json({ error: 'Rate limit exceeded' }, 429);

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'Request too large' }, 413);

    const body = await req.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const systemPrompt = typeof body?.systemPrompt === 'string' ? body.systemPrompt : '';
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const toolsLength = JSON.stringify(tools).length;
    if (
      !text ||
      text.length > MAX_TEXT_LENGTH ||
      systemPrompt.length > MAX_PROMPT_LENGTH ||
      tools.length > 10 ||
      toolsLength > MAX_TOOLS_LENGTH
    ) {
      return json({ error: 'Invalid request' }, 400);
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          tools,
        }),
      },
    );

    if (!response.ok) {
      console.error(`[ai-chat] Gemini request failed with status ${response.status}`);
      return json({ error: 'AI provider unavailable' }, 502);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCall = parts.find((part: Record<string, unknown>) => part.functionCall)?.functionCall;
    if (functionCall) return json({ functionCall });

    const reply = parts.find((part: Record<string, unknown>) => typeof part.text === 'string')?.text;
    if (!reply) return json({ error: 'AI provider returned no content' }, 502);
    return json({ text: reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ai-chat] ${message}`);
    return json({ error: 'AI service failed' }, 500);
  }
});

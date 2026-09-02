import { supabase } from './supabase.js';

const AI_TIMEOUT_MS = 20_000;

export async function generateAiReply({ text, systemPrompt, tools }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { text, systemPrompt, tools },
      signal: controller.signal,
    });

    if (error) throw error;
    if (!data || (typeof data.text !== 'string' && !data.functionCall)) {
      throw new Error('AI service returned an invalid response.');
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

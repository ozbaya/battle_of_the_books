import OpenAI from 'openai';
import type { Question } from '@/lib/game/types';

// Whisper's `prompt` parameter is only ever used as the *last* ~224 tokens
// of whatever you pass — anything beyond that is silently truncated by the
// API, not an error. A character budget here (~4 chars/token, with
// headroom) keeps the prompt we build within that window ourselves, so we
// control what gets truncated rather than the API chopping it arbitrarily.
const PROMPT_CHAR_BUDGET = 850;

/**
 * Lists unique title/author pairs from the question set, to bias Whisper's
 * spelling of book names, without singling out which one is correct.
 *
 * Two failure modes this specifically guards against, found via a real
 * report ("it keeps coming back as 'by Jonah Winter'" when a kid was slow
 * to start talking): (1) a question bank with many trivia questions per
 * book produces many duplicate "Title by Author" entries — joining them
 * unfiltered buries the prompt in repetition; (2) a long prompt silently
 * truncates to its *tail*, so if that tail happens to be N copies of the
 * same entry, Whisper has nothing else to lean on. When fed near-silent
 * audio (e.g. a late start), Whisper tends to hallucinate a continuation of
 * its prompt context rather than return an honest empty transcript — so a
 * prompt dominated by one repeated "by Jonah Winter" reliably produces
 * exactly that hallucination. Deduplicating and capping to a safe budget
 * fixes both: the prompt that actually reaches the model is never
 * repetition-dominated, and never exceeds what the API will use anyway.
 */
export function buildTranscribePrompt(questions: Question[]): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const q of questions) {
    const key = `${q.title}|${q.author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(`${q.title} by ${q.author}`);
  }

  let prompt = '';
  for (const entry of entries) {
    const next = prompt ? `${prompt}; ${entry}` : entry;
    if (next.length > PROMPT_CHAR_BUDGET) break;
    prompt = next;
  }
  return prompt;
}

export interface TranscribeInput {
  /** The audio clip, named with the extension matching its mime type (answer.webm / answer.m4a) — Whisper uses the extension. */
  file: Blob;
  filename: string;
  /** Titles + authors from the current question set, to bias spelling. Never singles out the correct answer. */
  prompt: string;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function transcribeAnswer(input: TranscribeInput): Promise<string> {
  if (process.env.MOCK_AI === 'true') {
    throw new Error('transcribeAnswer should not be called under MOCK_AI — /play submits typed text directly');
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1';
  // Give the Blob a proper filename so the SDK's multipart upload — and
  // Whisper's own format sniffing — see the right extension.
  const file = new File([input.file], input.filename, { type: input.file.type });

  const result = await getClient().audio.transcriptions.create({
    file,
    model,
    language: 'en',
    prompt: input.prompt,
  });
  return result.text ?? '';
}

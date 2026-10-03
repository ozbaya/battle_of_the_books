import OpenAI from 'openai';

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

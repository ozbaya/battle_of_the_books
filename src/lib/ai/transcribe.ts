export interface TranscribeInput {
  /** The audio clip, named with the extension matching its mime type (answer.webm / answer.m4a). */
  file: File | Blob;
  filename: string;
  /** Titles + authors from the current question set, to bias spelling. Never singles out the correct answer. */
  prompt: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed now; body arrives in Milestone 6
export async function transcribeAnswer(_input: TranscribeInput): Promise<string> {
  if (process.env.MOCK_AI === 'true') {
    throw new Error('transcribeAnswer should not be called under MOCK_AI — /play submits typed text directly');
  }
  // Real Whisper transcription arrives in Milestone 6.
  throw new Error('transcribeAnswer: real Whisper transcription is not implemented yet (Milestone 6)');
}

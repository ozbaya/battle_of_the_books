import { RECORDING_DURATION_MS } from '@/lib/game/config';

/**
 * TypeScript port of reference/audio-recording-reference.js, kept close to
 * its start/stop/cancel structure and error-handling-by-name, with the
 * changes CLAUDE.md §6 calls for: a 5s hard limit anchored to the
 * recorder's own 'start' event (not the tap), upload instead of playback,
 * and mime-type negotiation for Safari.
 */

export type RecorderErrorKind = 'not-supported' | 'permission-denied' | 'no-microphone' | 'hardware-error' | 'unknown';

export interface RecorderError {
  kind: RecorderErrorKind;
  message: string;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  filename: string;
}

function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

const MIME_CANDIDATES: Array<{ mimeType: string; filename: string }> = [
  { mimeType: 'audio/webm;codecs=opus', filename: 'answer.webm' },
  { mimeType: 'audio/mp4', filename: 'answer.m4a' },
];

function pickMimeType(): { mimeType: string; filename: string } {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
  }
  return { mimeType: '', filename: 'answer.webm' };
}

function classifyError(err: unknown): RecorderError {
  const name = err instanceof Error ? err.name : 'UnknownError';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'permission-denied', message: 'Microphone access was blocked. Please allow the microphone and try again.' };
    case 'NotFoundError':
      return { kind: 'no-microphone', message: 'No microphone was found on this device.' };
    case 'NotReadableError':
      return { kind: 'hardware-error', message: 'The microphone could not be started. Please try again.' };
    default:
      return { kind: 'unknown', message: 'Something went wrong with the microphone. Please try again.' };
  }
}

/**
 * Requests mic permission and holds the stream open just long enough for a
 * quick "say something" level check, then stops all tracks immediately. Must
 * be called from a user gesture (the "Join" tap) so iOS Safari allows it.
 */
export async function armMicrophone(
  onLevel: (level: number) => void,
  checkMs = 700
): Promise<{ ok: true } | { ok: false; error: RecorderError }> {
  if (!isRecordingSupported()) {
    return { ok: false, error: { kind: 'not-supported', message: 'This browser does not support recording audio.' } };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await meterLevel(stream, checkMs, onLevel);
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}

async function meterLevel(stream: MediaStream, durationMs: number, onLevel: (level: number) => void): Promise<void> {
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const start = Date.now();

  await new Promise<void>((resolve) => {
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      onLevel(Math.min(1, rms * 4));
      if (Date.now() - start < durationMs) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }
    tick();
  });
  await ctx.close();
}

/** One answer's worth of recording: start -> (auto or manual) stop -> blob, or cancel -> nothing uploaded. */
export class AnswerRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private filename = 'answer.webm';
  /**
   * Set synchronously by cancel(), even if it runs while getUserMedia() is
   * still in flight — e.g. React (Strict Mode's dev-only double effect
   * invoke, or any other fast remount) can call cancel() before start()'s
   * await resolves. Without this flag, a no-op cancel() leaves the
   * in-flight stream's recorder running orphaned in the background, with no
   * reference left to stop it, which is exactly the class of bug that leaves
   * the mic recording nothing the caller ever sees.
   */
  private cancelled = false;

  /**
   * Resolves once recording has actually started (mic acquired), calling
   * onStarted — the 5s window is anchored here, not at the call site.
   * `onAutoStop` fires with the recorded clip (or null) when the 5s hard
   * limit elapses on its own, so the caller only needs one upload path —
   * the manual `stop()` below is for an explicit early "Done" tap.
   */
  async start(
    onStarted: () => void,
    onAutoStop: (result: RecordingResult | null) => void
  ): Promise<{ ok: true } | { ok: false; error: RecorderError }> {
    if (!isRecordingSupported()) {
      return { ok: false, error: { kind: 'not-supported', message: 'This browser does not support recording audio.' } };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return { ok: false, error: { kind: 'unknown', message: 'Recording was cancelled.' } };
      }
      this.stream = stream;
      const { mimeType, filename } = pickMimeType();
      this.filename = filename;
      this.mediaRecorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
      this.chunks = [];

      this.mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      });
      this.mediaRecorder.addEventListener('start', () => {
        onStarted();
        this.stopTimer = setTimeout(() => {
          this.stop().then(onAutoStop);
        }, RECORDING_DURATION_MS);
      });

      this.mediaRecorder.start();
      return { ok: true };
    } catch (err) {
      this.cleanupStream();
      return { ok: false, error: classifyError(err) };
    }
  }

  /** Stops and resolves with the recorded clip, or null if nothing was captured. */
  stop(): Promise<RecordingResult | null> {
    return new Promise((resolve) => {
      const mr = this.mediaRecorder;
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      if (!mr || mr.state === 'inactive') {
        this.cleanupStream();
        resolve(null);
        return;
      }
      const mimeType = mr.mimeType || 'audio/webm';
      const filename = this.filename;
      const chunks = this.chunks;
      mr.addEventListener(
        'stop',
        () => {
          this.cleanupStream();
          const blob = new Blob(chunks, { type: mimeType });
          resolve(blob.size > 0 ? { blob, mimeType, filename } : null);
        },
        { once: true }
      );
      mr.stop();
    });
  }

  /** Stops and discards — nothing is uploaded. */
  cancel(): void {
    this.cancelled = true;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // already stopping/stopped
      }
    }
    this.cleanupStream();
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }
}

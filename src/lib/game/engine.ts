import {
  ADVANCE_ITERATION_CAP,
  DIFFICULTY_CONFIG,
  FOLLOW_UP_WINDOW_MS,
  GET_READY_DURATION_MS,
  REVEAL_DURATION_MS,
  ROBOT_THINK_MS,
  SCORE,
  STEAL_WINDOW_MS,
  ANSWER_DEADLINE_MS,
} from './config';
import { deriveRobotPlan, sampleDistinct } from './rng';
import { recomputeScores, scoreAnswer } from './scoring';
import type {
  AnswerRecord,
  Difficulty,
  GameState,
  KidAnswer,
  KidsRoundPhase,
  OverrideBucket,
  Phase,
  Player,
  Question,
  RobotPlan,
} from './types';

export function createGame(params: {
  code: string;
  teamName: string;
  difficulty: Difficulty;
  numQuestions: number;
  totalQuestions: number;
  seed: number;
  now: number;
  rng: () => number;
}): GameState {
  const questionOrder = sampleDistinct(params.totalQuestions, params.numQuestions, params.rng);
  return {
    code: params.code,
    version: 0,
    createdAt: params.now,
    seed: params.seed,
    questionOrder,
    currentIndex: 0,
    numQuestions: questionOrder.length,
    difficulty: params.difficulty,
    teamName: params.teamName,
    players: {},
    teamScore: 0,
    robotScore: 0,
    phase: { name: 'LOBBY' },
    history: [],
  };
}

export function applyJoin(state: GameState, playerId: string, name: string): GameState {
  if (state.phase.name === 'GAME_OVER') return state;
  if (state.players[playerId]) return state;
  const player: Player = { id: playerId, name, score: 0, full: 0, titleOnly: 0, wrong: 0, noAnswer: 0 };
  return { ...state, players: { ...state.players, [playerId]: player } };
}

export function applyStart(state: GameState, now: number): GameState {
  if (state.phase.name !== 'LOBBY') return state;
  return { ...state, phase: { name: 'GET_READY', opensAt: now + GET_READY_DURATION_MS } };
}

export function applyEndGame(state: GameState): GameState {
  if (state.phase.name === 'GAME_OVER') return state;
  return { ...state, phase: { name: 'GAME_OVER' } };
}

export function applyPress(
  state: GameState,
  playerId: string,
  now: number
): { state: GameState; accepted: boolean; isFirstRespondent: boolean } {
  if (state.phase.name !== 'KIDS_ROUND') {
    return { state, accepted: false, isFirstRespondent: false };
  }
  const phase = state.phase;
  if (phase.answers[playerId]) {
    return { state, accepted: false, isFirstRespondent: false };
  }
  if (phase.firstRespondent && now >= (phase.buttonsCloseAt as number)) {
    return { state, accepted: false, isFirstRespondent: false };
  }

  const isFirstRespondent = !phase.firstRespondent;
  const answer: KidAnswer = {
    playerId,
    pressedAt: now,
    deadline: now + ANSWER_DEADLINE_MS,
    status: 'recording',
  };
  const newPhase: KidsRoundPhase = {
    ...phase,
    robotBuzzAt: isFirstRespondent ? undefined : phase.robotBuzzAt,
    firstRespondent: phase.firstRespondent ?? playerId,
    buttonsCloseAt: phase.buttonsCloseAt ?? now + FOLLOW_UP_WINDOW_MS,
    answers: { ...phase.answers, [playerId]: answer },
  };
  return { state: { ...state, phase: newPhase }, accepted: true, isFirstRespondent };
}

export interface JudgmentResult {
  transcript: string;
  titleCorrect: boolean;
  authorCorrect: boolean;
  recorded: boolean;
  needsReview?: boolean;
}

export function applyJudgment(state: GameState, playerId: string, result: JudgmentResult): GameState {
  if (state.phase.name !== 'KIDS_ROUND') return state;
  const phase = state.phase;
  const existing = phase.answers[playerId];
  if (!existing || existing.status === 'done') return state;

  const points = scoreAnswer(result);
  const updatedAnswer: KidAnswer = {
    ...existing,
    status: 'done',
    transcript: result.transcript,
    titleCorrect: result.titleCorrect,
    authorCorrect: result.authorCorrect,
    points,
    recorded: result.recorded,
    needsReview: result.needsReview,
  };
  const record: AnswerRecord = {
    questionIndex: state.currentIndex,
    by: playerId,
    transcript: result.transcript,
    titleCorrect: result.titleCorrect,
    authorCorrect: result.authorCorrect,
    points,
    isSteal: phase.isSteal,
    countsForTeam: phase.firstRespondent === playerId,
    recorded: result.recorded,
    needsReview: result.needsReview,
  };

  const next: GameState = {
    ...state,
    phase: { ...phase, answers: { ...phase.answers, [playerId]: updatedAnswer } },
    history: [...state.history, record],
  };
  return recomputeScores(next);
}

function bucketToJudgment(bucket: OverrideBucket): JudgmentResult {
  switch (bucket) {
    case 'full':
      return { transcript: '', titleCorrect: true, authorCorrect: true, recorded: true };
    case 'titleOnly':
      return { transcript: '', titleCorrect: true, authorCorrect: false, recorded: true };
    case 'wrong':
      return { transcript: '', titleCorrect: false, authorCorrect: false, recorded: true };
    case 'none':
      return { transcript: '', titleCorrect: false, authorCorrect: false, recorded: false };
  }
}

/**
 * Corrects a past answer's score. Only ever touches `history` + recomputed
 * scores — it never replays or rewrites the phase sequence that already
 * happened (e.g. a robot steal that was triggered by the original wrong
 * verdict stays in the narration; only the scoreboard changes).
 */
export function applyAdminOverride(state: GameState, historyIndex: number, bucket: OverrideBucket): GameState {
  if (historyIndex < 0 || historyIndex >= state.history.length) return state;
  const existing = state.history[historyIndex];
  const fields = bucketToJudgment(bucket);
  const history = state.history.slice();
  history[historyIndex] = {
    ...existing,
    titleCorrect: fields.titleCorrect,
    authorCorrect: fields.authorCorrect,
    recorded: fields.recorded,
    points: scoreAnswer(fields),
    needsReview: false,
  };
  return recomputeScores({ ...state, history });
}

export function getCurrentQuestion(state: GameState, questions: Question[]): Question {
  const idx = state.questionOrder[state.currentIndex];
  return questions[idx];
}

function getDistractor(state: GameState, questions: Question[]): Question {
  const idx = state.questionOrder[state.currentIndex];
  const distractorIdx = (idx + 1) % questions.length;
  return questions[distractorIdx];
}

function planFor(state: GameState, questions: Question[], attempt: 'first' | 'steal'): RobotPlan {
  const correct = getCurrentQuestion(state, questions);
  const distractor = getDistractor(state, questions);
  const difficulty = DIFFICULTY_CONFIG[state.difficulty];
  return deriveRobotPlan({
    seed: state.seed,
    questionIndex: state.currentIndex,
    attempt,
    correctTitle: correct.title,
    correctAuthor: correct.author,
    distractorTitle: distractor.title,
    distractorAuthor: distractor.author,
    accuracy: difficulty.accuracy,
    authorRate: difficulty.authorRate,
  });
}

function allAnswersDone(phase: KidsRoundPhase): boolean {
  return Object.values(phase.answers).every((a) => a.status === 'done');
}

/** Force-resolves the first still-pending answer whose deadline has passed, to 0 points. */
function resolveOneExpiredAnswer(state: GameState, now: number): GameState {
  if (state.phase.name !== 'KIDS_ROUND') return state;
  const phase = state.phase;
  const expiredId = Object.keys(phase.answers).find((id) => {
    const a = phase.answers[id];
    return a.status !== 'done' && now >= a.deadline;
  });
  if (!expiredId) return state;
  return applyJudgment(state, expiredId, {
    transcript: '',
    titleCorrect: false,
    authorCorrect: false,
    recorded: false,
  });
}

function addRobotAnswer(state: GameState, plan: RobotPlan, isSteal: boolean): GameState {
  const points = scoreAnswer({ titleCorrect: plan.titleCorrect, authorCorrect: plan.authorCorrect, recorded: true });
  const record: AnswerRecord = {
    questionIndex: state.currentIndex,
    by: 'robots',
    transcript: `${plan.displayTitle} by ${plan.displayAuthor}`,
    titleCorrect: plan.titleCorrect,
    authorCorrect: plan.authorCorrect,
    points,
    isSteal,
    countsForTeam: false,
    recorded: true,
  };
  return recomputeScores({ ...state, history: [...state.history, record] });
}

/**
 * Applies exactly one time-based transition, or returns `state` unchanged
 * (by reference) if none of GameState's deadlines have passed yet. advance()
 * below loops this to a fixed point. No I/O, no randomness beyond the
 * seeded, pure `deriveRobotPlan`.
 */
function advanceOnce(state: GameState, now: number, questions: Question[]): GameState {
  switch (state.phase.name) {
    case 'LOBBY':
      return state;

    case 'GET_READY': {
      if (now < state.phase.opensAt) return state;
      const difficulty = DIFFICULTY_CONFIG[state.difficulty];
      return {
        ...state,
        phase: {
          name: 'KIDS_ROUND',
          isSteal: false,
          openedAt: state.phase.opensAt,
          robotBuzzAt: state.phase.opensAt + difficulty.robotDelayMs,
          answers: {},
        },
      };
    }

    case 'KIDS_ROUND': {
      const resolved = resolveOneExpiredAnswer(state, now);
      if (resolved !== state) return resolved;

      const phase = state.phase;

      if (!phase.firstRespondent) {
        if (!phase.isSteal && phase.robotBuzzAt !== undefined && now >= phase.robotBuzzAt) {
          const plan = planFor(state, questions, 'first');
          return {
            ...state,
            phase: {
              name: 'ROBOT_ANSWERING',
              isSteal: false,
              buzzAt: phase.robotBuzzAt,
              revealAt: phase.robotBuzzAt + ROBOT_THINK_MS,
              plan,
            },
          };
        }
        if (phase.isSteal && now >= phase.openedAt + STEAL_WINDOW_MS) {
          return { ...state, phase: { name: 'REVEAL', nextAt: now + REVEAL_DURATION_MS } };
        }
        return state;
      }

      if (now >= (phase.buttonsCloseAt as number) && allAnswersDone(phase)) {
        const firstAnswer = phase.answers[phase.firstRespondent];
        if ((firstAnswer.points ?? 0) > 0) {
          return { ...state, phase: { name: 'REVEAL', nextAt: now + REVEAL_DURATION_MS } };
        }
        if (!phase.isSteal) {
          const plan = planFor(state, questions, 'steal');
          const robotDelay = DIFFICULTY_CONFIG[state.difficulty].robotDelayMs;
          return {
            ...state,
            phase: {
              name: 'ROBOT_ANSWERING',
              isSteal: true,
              buzzAt: now + robotDelay,
              revealAt: now + robotDelay + ROBOT_THINK_MS,
              plan,
            },
          };
        }
        return { ...state, phase: { name: 'REVEAL', nextAt: now + REVEAL_DURATION_MS } };
      }
      return state;
    }

    case 'ROBOT_ANSWERING': {
      const phase = state.phase;
      if (now < phase.revealAt) return state;

      const withAnswer = addRobotAnswer(state, phase.plan, phase.isSteal);
      if (phase.plan.titleCorrect) {
        return { ...withAnswer, phase: { name: 'REVEAL', nextAt: now + REVEAL_DURATION_MS } };
      }
      if (!phase.isSteal) {
        return { ...withAnswer, phase: { name: 'KIDS_ROUND', isSteal: true, openedAt: now, answers: {} } };
      }
      return { ...withAnswer, phase: { name: 'REVEAL', nextAt: now + REVEAL_DURATION_MS } };
    }

    case 'REVEAL': {
      if (now < state.phase.nextAt) return state;
      if (state.currentIndex + 1 < state.numQuestions) {
        return {
          ...state,
          currentIndex: state.currentIndex + 1,
          phase: { name: 'GET_READY', opensAt: now + GET_READY_DURATION_MS },
        };
      }
      return { ...state, phase: { name: 'GAME_OVER' } };
    }

    case 'GAME_OVER':
      return state;
  }
}

/**
 * The key design decision (CLAUDE.md §4.1): applies every transition whose
 * deadline has passed, looping to a fixed point, with no I/O. Called before
 * every action, including read-only state polls, so the game advances on
 * its own even though Vercel has no timers.
 */
export function advance(state: GameState, now: number, questions: Question[]): GameState {
  let current = state;
  for (let i = 0; i < ADVANCE_ITERATION_CAP; i++) {
    const next = advanceOnce(current, now, questions);
    if (next === current) return current;
    current = next;
  }
  throw new Error('advance() exceeded its iteration cap — check config.ts durations for a transition cycle');
}

export interface PublicGameState {
  code: string;
  teamName: string;
  difficulty: Difficulty;
  numQuestions: number;
  currentIndex: number;
  phase: Phase;
  players: Record<string, Player>;
  teamScore: number;
  robotScore: number;
  history: AnswerRecord[];
  questionText: string | null;
  correctAnswer: { title: string; author: string } | null;
  serverNow: number;
}

/**
 * Never send the correct answer to /play or /screen before REVEAL (CLAUDE.md
 * §4.3). Everything else in GameState — including per-answer titleCorrect /
 * authorCorrect flags and the robots' displayed answer once they've buzzed —
 * is safe to show live; only the question bank's answer key is secret.
 */
export function toPublicGameState(state: GameState, questions: Question[], now: number): PublicGameState {
  const revealed = state.phase.name === 'REVEAL' || state.phase.name === 'GAME_OVER';
  const current = questions.length > 0 ? getCurrentQuestion(state, questions) : null;
  return {
    code: state.code,
    teamName: state.teamName,
    difficulty: state.difficulty,
    numQuestions: state.numQuestions,
    currentIndex: state.currentIndex,
    phase: state.phase,
    players: state.players,
    teamScore: state.teamScore,
    robotScore: state.robotScore,
    history: state.history,
    questionText: current?.question ?? null,
    correctAnswer: revealed && current ? { title: current.title, author: current.author } : null,
    serverNow: now,
  };
}

export { SCORE };

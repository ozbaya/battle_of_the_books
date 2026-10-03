import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_WINDOW_MS, GET_READY_DURATION_MS, STEAL_WINDOW_MS } from './config';
import {
  advance,
  applyAdminOverride,
  applyEndGame,
  applyJoin,
  applyJudgment,
  applyPress,
  applyStart,
  createGame,
  getCurrentQuestion,
} from './engine';
import { deriveRobotPlan, hashSeed } from './rng';
import { recomputeScores, scoreAnswer } from './scoring';
import type { Difficulty, GameState, Phase, Question } from './types';

const QUESTIONS: Question[] = [
  { question: 'Q0: boy digs holes at camp', title: 'Holes', author: 'Louis Sachar' },
  { question: "Q1: spider writes in her web", title: "Charlotte's Web", author: 'E.B. White' },
  { question: 'Q2: boy with facial differences starts school', title: 'Wonder', author: 'R.J. Palacio' },
  { question: 'Q3: girl discovers she can do magic', title: 'Matilda', author: 'Roald Dahl' },
];

function makeGame(
  overrides: Partial<{ difficulty: Difficulty; numQuestions: number; totalQuestions: number; seed: number }> = {}
): GameState {
  return createGame({
    code: 'TEST1',
    teamName: 'Testers',
    difficulty: overrides.difficulty ?? 'medium',
    numQuestions: overrides.numQuestions ?? QUESTIONS.length,
    totalQuestions: overrides.totalQuestions ?? QUESTIONS.length,
    seed: overrides.seed ?? 1,
    now: 0,
    rng: () => 0, // deterministic: questionOrder = [0, 1, 2, ...]
  });
}

function expectPhase<N extends Phase['name']>(state: GameState, name: N): Extract<Phase, { name: N }> {
  expect(state.phase.name).toBe(name);
  return state.phase as Extract<Phase, { name: N }>;
}

/** Drives a fresh game from LOBBY to the start of its first KIDS_ROUND. */
function openFirstQuestion(difficulty: Difficulty = 'medium'): { state: GameState; openedAt: number } {
  let state = makeGame({ difficulty });
  state = applyJoin(state, 'maya', 'Maya');
  state = applyJoin(state, 'leo', 'Leo');
  state = applyStart(state, 0);
  state = advance(state, GET_READY_DURATION_MS, QUESTIONS);
  expectPhase(state, 'KIDS_ROUND');
  return { state, openedAt: GET_READY_DURATION_MS };
}

describe('scoreAnswer', () => {
  it('scores 2 for correct title and author', () => {
    expect(scoreAnswer({ titleCorrect: true, authorCorrect: true, recorded: true })).toBe(2);
  });

  it('scores 1 for correct title, wrong author', () => {
    expect(scoreAnswer({ titleCorrect: true, authorCorrect: false, recorded: true })).toBe(1);
  });

  it('scores 1 for correct title, missing author (same as wrong author)', () => {
    expect(scoreAnswer({ titleCorrect: true, authorCorrect: false, recorded: true })).toBe(1);
  });

  it('scores -0.5 for wrong title regardless of author', () => {
    expect(scoreAnswer({ titleCorrect: false, authorCorrect: false, recorded: true })).toBe(-0.5);
    expect(scoreAnswer({ titleCorrect: false, authorCorrect: true, recorded: true })).toBe(-0.5);
  });

  it('scores 0 when nothing was recorded, regardless of correctness flags', () => {
    expect(scoreAnswer({ titleCorrect: true, authorCorrect: true, recorded: false })).toBe(0);
  });
});

describe('recomputeScores', () => {
  it('never scores a player who has no history entry at all (never pressed)', () => {
    let state = makeGame();
    state = applyJoin(state, 'maya', 'Maya');
    state = applyJoin(state, 'ava', 'Ava'); // never presses
    state = recomputeScores({
      ...state,
      history: [
        {
          questionIndex: 0,
          by: 'maya',
          transcript: 'holes by louis sachar',
          titleCorrect: true,
          authorCorrect: true,
          points: 2,
          isSteal: false,
          countsForTeam: true,
          recorded: true,
        },
      ],
    });
    expect(state.players.maya.score).toBe(2);
    expect(state.players.ava).toEqual({ id: 'ava', name: 'Ava', score: 0, full: 0, titleOnly: 0, wrong: 0, noAnswer: 0 });
  });

  it('is idempotent when run twice over the same history', () => {
    let state = makeGame();
    state = applyJoin(state, 'maya', 'Maya');
    const withHistory: GameState = {
      ...state,
      history: [
        {
          questionIndex: 0,
          by: 'maya',
          transcript: 'holes',
          titleCorrect: true,
          authorCorrect: false,
          points: 1,
          isSteal: false,
          countsForTeam: true,
          recorded: true,
        },
      ],
    };
    const once = recomputeScores(withHistory);
    const twice = recomputeScores(once);
    expect(twice.players.maya).toEqual(once.players.maya);
    expect(twice.teamScore).toBe(once.teamScore);
  });
});

describe('first-respondent rule', () => {
  it('first press sets firstRespondent and buttonsCloseAt = press time + FOLLOW_UP_WINDOW', () => {
    const { state } = openFirstQuestion();
    const { state: after, accepted, isFirstRespondent } = applyPress(state, 'maya', 3100);
    expect(accepted).toBe(true);
    expect(isFirstRespondent).toBe(true);
    const phase = expectPhase(after, 'KIDS_ROUND');
    expect(phase.firstRespondent).toBe('maya');
    expect(phase.buttonsCloseAt).toBe(3100 + FOLLOW_UP_WINDOW_MS);
  });

  it('a second press is recorded individually but does not change firstRespondent', () => {
    const { state } = openFirstQuestion();
    const afterFirst = applyPress(state, 'maya', 3100).state;
    const { state: afterSecond, accepted, isFirstRespondent } = applyPress(afterFirst, 'leo', 3200);
    expect(accepted).toBe(true);
    expect(isFirstRespondent).toBe(false);
    const phase = expectPhase(afterSecond, 'KIDS_ROUND');
    expect(phase.firstRespondent).toBe('maya');
    expect(phase.answers.leo).toBeDefined();
  });

  it('team score reflects only the first respondent, even when a later kid answers correctly', () => {
    const { state } = openFirstQuestion();
    let s = applyPress(state, 'maya', 3100).state; // first respondent
    s = applyPress(s, 'leo', 3200).state;
    s = applyJudgment(s, 'maya', { transcript: 'a dog book', titleCorrect: false, authorCorrect: false, recorded: true }); // wrong
    s = applyJudgment(s, 'leo', { transcript: 'holes by louis sachar', titleCorrect: true, authorCorrect: true, recorded: true }); // correct
    expect(s.players.maya.score).toBe(-0.5);
    expect(s.players.leo.score).toBe(2);
    expect(s.teamScore).toBe(-0.5); // only maya (first respondent) counts for the team
  });

  it('a press after buttonsCloseAt is rejected', () => {
    const { state } = openFirstQuestion();
    const afterFirst = applyPress(state, 'maya', 3100).state;
    const closesAt = (afterFirst.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).buttonsCloseAt!;
    const { accepted } = applyPress(afterFirst, 'leo', closesAt);
    expect(accepted).toBe(false);
  });

  it('a kid cannot press twice in the same question', () => {
    const { state } = openFirstQuestion();
    const afterFirst = applyPress(state, 'maya', 3100).state;
    const { accepted } = applyPress(afterFirst, 'maya', 3150);
    expect(accepted).toBe(false);
  });
});

describe('robot timing per difficulty', () => {
  it.each([
    ['easy', 7000],
    ['medium', 5000],
    ['hard', 5000],
  ] as const)('robotBuzzAt = openedAt + %s delay (%s)', (difficulty, delay) => {
    const { state, openedAt } = openFirstQuestion(difficulty);
    const phase = expectPhase(state, 'KIDS_ROUND');
    expect(phase.robotBuzzAt).toBe(openedAt + delay);
  });

  it('robot plan is identical across repeated advance() calls with the same seed/questionIndex/attempt', () => {
    const { state, openedAt } = openFirstQuestion('hard');
    const buzzAt = openedAt + 5000;
    const a = advance(state, buzzAt, QUESTIONS);
    const b = advance(state, buzzAt, QUESTIONS); // simulates a retried CAS write re-deriving from the same stale state
    const phaseA = expectPhase(a, 'ROBOT_ANSWERING');
    const phaseB = expectPhase(b, 'ROBOT_ANSWERING');
    expect(phaseB.plan).toEqual(phaseA.plan);
  });

  it("robot plan derivation key differs between 'first' and 'steal' attempts", () => {
    expect(hashSeed(1, 0, 'first')).not.toBe(hashSeed(1, 0, 'steal'));
  });
});

describe('phase diagram — forward flow', () => {
  it('LOBBY stays LOBBY until applyStart is called; advance() alone never leaves it', () => {
    const state = makeGame();
    const after = advance(state, 1_000_000, QUESTIONS);
    expect(after.phase.name).toBe('LOBBY');
  });

  it('GET_READY transitions to KIDS_ROUND exactly at opensAt, not before', () => {
    const state = applyStart(makeGame(), 0);
    expect(advance(state, GET_READY_DURATION_MS - 1, QUESTIONS).phase.name).toBe('GET_READY');
    expect(advance(state, GET_READY_DURATION_MS, QUESTIONS).phase.name).toBe('KIDS_ROUND');
  });

  it('KIDS_ROUND transitions to ROBOT_ANSWERING at robotBuzzAt when no kid has pressed', () => {
    const { state, openedAt } = openFirstQuestion('hard');
    const after = advance(state, openedAt + 5000, QUESTIONS);
    expectPhase(after, 'ROBOT_ANSWERING');
  });

  it('a kid press strictly before robotBuzzAt blocks the robot transition even once robotBuzzAt has passed', () => {
    const { state, openedAt } = openFirstQuestion('medium'); // robotBuzzAt = openedAt + 5000
    const pressed = applyPress(state, 'maya', openedAt + 500).state;
    // now is past robotBuzzAt, but before maya's own follow-up window/deadline close
    const after = advance(pressed, openedAt + 5500, QUESTIONS);
    const phase = expectPhase(after, 'KIDS_ROUND');
    expect(phase.firstRespondent).toBe('maya');
  });

  it('ROBOT_ANSWERING resolves to REVEAL at revealAt when the robot plan is correct', () => {
    // seed/difficulty chosen so the robots' first attempt is correct
    const { state, openedAt } = openFirstQuestion('hard');
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const g = { ...state, seed };
      const buzzAt = openedAt + 5000;
      const robotPhase = advance(g, buzzAt, QUESTIONS);
      if (robotPhase.phase.name === 'ROBOT_ANSWERING' && robotPhase.phase.plan.titleCorrect) {
        const revealed = advance(robotPhase, robotPhase.phase.revealAt, QUESTIONS);
        expect(revealed.phase.name).toBe('REVEAL');
        expect(revealed.robotScore).toBeGreaterThan(0);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('ROBOT_ANSWERING resolves to KIDS_ROUND{isSteal:true} when the plan is wrong and it was the first attempt', () => {
    const { state, openedAt } = openFirstQuestion('hard');
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const g = { ...state, seed };
      const buzzAt = openedAt + 5000;
      const robotPhase = advance(g, buzzAt, QUESTIONS);
      if (robotPhase.phase.name === 'ROBOT_ANSWERING' && !robotPhase.phase.plan.titleCorrect) {
        const revealed = advance(robotPhase, robotPhase.phase.revealAt, QUESTIONS);
        const phase = expectPhase(revealed, 'KIDS_ROUND');
        expect(phase.isSteal).toBe(true);
        expect(revealed.robotScore).toBe(-0.5);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('ROBOT_ANSWERING resolves to REVEAL (no further steal) when the steal attempt is also wrong', () => {
    const { state, openedAt } = openFirstQuestion('hard');
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      // Find a seed where the kid's first-attempt answer is wrong and the
      // robots' subsequent steal attempt is also wrong.
      const g = { ...state, seed };
      let s = applyPress(g, 'maya', openedAt + 500).state;
      s = applyJudgment(s, 'maya', { transcript: 'wrong', titleCorrect: false, authorCorrect: false, recorded: true });
      const closesAt = (s.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).buttonsCloseAt!;
      const robotStealPhase = advance(s, closesAt, QUESTIONS);
      if (robotStealPhase.phase.name === 'ROBOT_ANSWERING' && !robotStealPhase.phase.plan.titleCorrect) {
        const revealed = advance(robotStealPhase, robotStealPhase.phase.revealAt, QUESTIONS);
        expect(revealed.phase.name).toBe('REVEAL');
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('REVEAL transitions to GET_READY for the next question when questions remain', () => {
    let state = makeGame({ numQuestions: 2 });
    state = applyStart(state, 0);
    state = advance(state, GET_READY_DURATION_MS, QUESTIONS);
    // force-resolve: nobody presses, let robots answer and reveal via raw phase injection
    const revealState: GameState = { ...state, phase: { name: 'REVEAL', nextAt: 100 } };
    const after = advance(revealState, 100, QUESTIONS);
    const phase = expectPhase(after, 'GET_READY');
    expect(after.currentIndex).toBe(1);
    expect(phase.opensAt).toBe(100 + GET_READY_DURATION_MS);
  });

  it('REVEAL transitions to GAME_OVER on the last question', () => {
    const state = makeGame({ numQuestions: 1 });
    const revealState: GameState = { ...state, currentIndex: 0, phase: { name: 'REVEAL', nextAt: 100 } };
    const after = advance(revealState, 100, QUESTIONS);
    expect(after.phase.name).toBe('GAME_OVER');
  });

  it('advance() chains multiple phase transitions in one call from a stale state', () => {
    let state = makeGame({ numQuestions: 2, difficulty: 'hard' });
    state = applyStart(state, 0);
    // Jump straight from LOBBY-just-started to long after the robots would
    // have answered and the reveal window would have closed, in one call.
    const after = advance(state, 1_000_000, QUESTIONS);
    // Either a robot win ended the game at REVEAL-pending-next, or further —
    // either way we should have moved well past GET_READY/KIDS_ROUND for Q0.
    expect(['ROBOT_ANSWERING', 'KIDS_ROUND', 'REVEAL', 'GET_READY', 'GAME_OVER']).toContain(after.phase.name);
    expect(after.history.length).toBeGreaterThan(0);
  });
});

describe('follow-up window and steals in both directions', () => {
  it('teammates can still answer during the follow-up window after a correct first respondent, without affecting team score', () => {
    const { state } = openFirstQuestion();
    let s = applyPress(state, 'maya', 3100).state;
    s = applyPress(s, 'leo', 3200).state;
    s = applyJudgment(s, 'maya', { transcript: 'holes by louis sachar', titleCorrect: true, authorCorrect: true, recorded: true });
    s = applyJudgment(s, 'leo', { transcript: 'wrong book', titleCorrect: false, authorCorrect: false, recorded: true });
    expect(s.teamScore).toBe(2);
    expect(s.players.leo.score).toBe(-0.5);
    const after = advance(s, 3100 + FOLLOW_UP_WINDOW_MS, QUESTIONS);
    expect(after.phase.name).toBe('REVEAL');
  });

  it('a wrong/no-answer first respondent triggers a robot steal once the follow-up window closes and all answers are done', () => {
    const { state } = openFirstQuestion();
    let s = applyPress(state, 'maya', 3100).state;
    s = applyJudgment(s, 'maya', { transcript: 'wrong', titleCorrect: false, authorCorrect: false, recorded: true });
    const closesAt = (s.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).buttonsCloseAt!;
    const after = advance(s, closesAt, QUESTIONS);
    const phase = expectPhase(after, 'ROBOT_ANSWERING');
    expect(phase.isSteal).toBe(true);
  });

  it('the kids steal window (after a robot miss) accepts a press and runs its own follow-up window', () => {
    const { state } = openFirstQuestion('hard');
    let stealState: GameState | null = null;
    for (let seed = 0; seed < 50 && !stealState; seed++) {
      const g = { ...state, seed };
      const robotPhase = advance(g, state.phase.name === 'KIDS_ROUND' ? state.phase.robotBuzzAt! : 0, QUESTIONS);
      if (robotPhase.phase.name === 'ROBOT_ANSWERING' && !robotPhase.phase.plan.titleCorrect) {
        const revealed = advance(robotPhase, robotPhase.phase.revealAt, QUESTIONS);
        if (revealed.phase.name === 'KIDS_ROUND' && revealed.phase.isSteal) stealState = revealed;
      }
    }
    expect(stealState).not.toBeNull();
    const steal = stealState!;
    const stealOpenedAt = (steal.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).openedAt;
    const { state: pressed, accepted } = applyPress(steal, 'maya', stealOpenedAt + 500);
    expect(accepted).toBe(true);
    const phase = expectPhase(pressed, 'KIDS_ROUND');
    expect(phase.firstRespondent).toBe('maya');
    expect(phase.buttonsCloseAt).toBe(stealOpenedAt + 500 + FOLLOW_UP_WINDOW_MS);
  });

  it('a kids steal window with no press transitions to REVEAL at openedAt + STEAL_WINDOW_MS with no team points', () => {
    const stealState: GameState = {
      ...makeGame(),
      phase: { name: 'KIDS_ROUND', isSteal: true, openedAt: 0, answers: {} },
    };
    const before = advance(stealState, STEAL_WINDOW_MS - 1, QUESTIONS);
    expect(before.phase.name).toBe('KIDS_ROUND');
    const after = advance(stealState, STEAL_WINDOW_MS, QUESTIONS);
    expect(after.phase.name).toBe('REVEAL');
    expect(after.teamScore).toBe(0);
  });

  it('robots never get a second steal attempt in the same question', () => {
    // Craft a steal KIDS_ROUND directly and drive a wrong kid answer through
    // it; the only possible next phase is REVEAL, never ROBOT_ANSWERING again.
    let s: GameState = {
      ...makeGame(),
      phase: { name: 'KIDS_ROUND', isSteal: true, openedAt: 0, answers: {} },
    };
    s = applyPress(s, 'maya', 100).state;
    s = applyJudgment(s, 'maya', { transcript: 'wrong', titleCorrect: false, authorCorrect: false, recorded: true });
    const closesAt = (s.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).buttonsCloseAt!;
    const after = advance(s, closesAt, QUESTIONS);
    expect(after.phase.name).toBe('REVEAL');
  });

  it('kids never get a second steal window in the same question', () => {
    // After a robot's steal attempt also misses, the only next phase is REVEAL.
    const robotSteal: GameState = {
      ...makeGame(),
      phase: {
        name: 'ROBOT_ANSWERING',
        isSteal: true,
        buzzAt: 0,
        revealAt: 0,
        plan: { titleCorrect: false, authorCorrect: false, displayTitle: 'Wrong Book', displayAuthor: 'Nobody' },
      },
    };
    const after = advance(robotSteal, 0, QUESTIONS);
    expect(after.phase.name).toBe('REVEAL');
  });
});

describe('deadline expiry', () => {
  it('a pressed answer past its deadline with no audio is force-resolved to 0 points, recorded:false', () => {
    // advance() runs to a fixed point, so once this (sole) answer is forced to
    // 0 the loop also closes the follow-up window and moves on — we assert on
    // the resulting history entry, not on which phase comes next.
    const { state } = openFirstQuestion();
    const pressed = applyPress(state, 'maya', 3100).state;
    const deadline = pressed.phase.name === 'KIDS_ROUND' ? pressed.phase.answers.maya.deadline : 0;
    const after = advance(pressed, deadline, QUESTIONS);
    const record = after.history.find((r) => r.by === 'maya' && r.questionIndex === 0);
    expect(record).toBeDefined();
    expect(record!.points).toBe(0);
    expect(record!.recorded).toBe(false);
  });

  it("forcing one kid's expired answer does not corrupt another kid's already-judged answer", () => {
    const { state } = openFirstQuestion();
    let s = applyPress(state, 'maya', 3100).state; // deadline = 3100+13000=16100
    s = applyPress(s, 'leo', 3105).state; // deadline = 16105
    // Resolve leo's answer normally, well before either deadline.
    s = applyJudgment(s, 'leo', { transcript: 'holes by louis sachar', titleCorrect: true, authorCorrect: true, recorded: true });
    // Advance past maya's deadline; the fixed point may move the phase along,
    // but leo's already-judged result must come through untouched.
    const after = advance(s, 16100, QUESTIONS);
    expect(after.players.leo.score).toBe(2);
    const mayaRecord = after.history.find((r) => r.by === 'maya');
    expect(mayaRecord?.points).toBe(0);
    expect(mayaRecord?.recorded).toBe(false);
  });

  it('KIDS_ROUND does not advance past buttonsCloseAt while any answer is still pending under its own deadline', () => {
    const { state } = openFirstQuestion();
    const pressed = applyPress(state, 'maya', 3100).state;
    const closesAt = (pressed.phase as Extract<Phase, { name: 'KIDS_ROUND' }>).buttonsCloseAt!;
    // At closesAt, maya's answer is still 'recording' and her deadline (16100) hasn't passed.
    const after = advance(pressed, closesAt, QUESTIONS);
    expect(after.phase.name).toBe('KIDS_ROUND');
  });
});

describe('admin override', () => {
  function stateWithOneAnswer(): GameState {
    const { state } = openFirstQuestion();
    let s = applyPress(state, 'maya', 3100).state;
    s = applyJudgment(s, 'maya', { transcript: 'wrong', titleCorrect: false, authorCorrect: false, recorded: true });
    return s;
  }

  it("overriding a kid's history entry updates teamScore and the player's bucket counts", () => {
    const s = stateWithOneAnswer();
    expect(s.teamScore).toBe(-0.5);
    expect(s.players.maya.wrong).toBe(1);
    const overridden = applyAdminOverride(s, 0, 'full');
    expect(overridden.teamScore).toBe(2);
    expect(overridden.players.maya.full).toBe(1);
    expect(overridden.players.maya.wrong).toBe(0);
  });

  it("overriding a robot's history entry updates robotScore, not teamScore", () => {
    let state = makeGame();
    state = {
      ...state,
      history: [
        {
          questionIndex: 0,
          by: 'robots',
          transcript: 'wrong book',
          titleCorrect: false,
          authorCorrect: false,
          points: -0.5,
          isSteal: false,
          countsForTeam: false,
          recorded: true,
        },
      ],
    };
    state = recomputeScores(state);
    expect(state.robotScore).toBe(-0.5);
    const overridden = applyAdminOverride(state, 0, 'full');
    expect(overridden.robotScore).toBe(2);
    expect(overridden.teamScore).toBe(0);
  });

  it('overriding an entry does not alter phase or currentIndex', () => {
    const s = stateWithOneAnswer();
    const overridden = applyAdminOverride(s, 0, 'full');
    expect(overridden.phase).toEqual(s.phase);
    expect(overridden.currentIndex).toBe(s.currentIndex);
  });
});

describe('safety', () => {
  it.each(['LOBBY', 'GET_READY', 'KIDS_ROUND', 'ROBOT_ANSWERING', 'REVEAL'] as const)(
    'applyEndGame transitions to GAME_OVER from %s',
    (phaseName) => {
      let state = makeGame();
      if (phaseName !== 'LOBBY') state = applyStart(state, 0);
      if (phaseName === 'GET_READY') {
        // already GET_READY after applyStart
      } else if (phaseName === 'KIDS_ROUND') {
        state = advance(state, GET_READY_DURATION_MS, QUESTIONS);
      } else if (phaseName === 'ROBOT_ANSWERING') {
        state = { ...state, phase: { name: 'ROBOT_ANSWERING', isSteal: false, buzzAt: 0, revealAt: 0, plan: { titleCorrect: true, authorCorrect: true, displayTitle: 'x', displayAuthor: 'y' } } };
      } else if (phaseName === 'REVEAL') {
        state = { ...state, phase: { name: 'REVEAL', nextAt: 0 } };
      }
      const after = applyEndGame(state);
      expect(after.phase.name).toBe('GAME_OVER');
    }
  );

  it("createGame's questionOrder contains numQuestions distinct indices, deterministic for a fixed rng", () => {
    const state = createGame({
      code: 'X',
      teamName: 'T',
      difficulty: 'easy',
      numQuestions: 3,
      totalQuestions: QUESTIONS.length,
      seed: 7,
      now: 0,
      rng: () => 0.5,
    });
    expect(state.questionOrder).toHaveLength(3);
    expect(new Set(state.questionOrder).size).toBe(3);
    const again = createGame({
      code: 'X',
      teamName: 'T',
      difficulty: 'easy',
      numQuestions: 3,
      totalQuestions: QUESTIONS.length,
      seed: 7,
      now: 0,
      rng: () => 0.5,
    });
    expect(again.questionOrder).toEqual(state.questionOrder);
  });

  it('getCurrentQuestion resolves the question bank entry at the sampled index', () => {
    const state = makeGame();
    expect(getCurrentQuestion(state, QUESTIONS)).toEqual(QUESTIONS[0]);
  });
});

describe('deriveRobotPlan', () => {
  it('is a pure function of its inputs', () => {
    const params = {
      seed: 1,
      questionIndex: 0,
      attempt: 'first' as const,
      correctTitle: 'Holes',
      correctAuthor: 'Louis Sachar',
      distractorTitle: "Charlotte's Web",
      distractorAuthor: 'E.B. White',
      accuracy: 0.6,
      authorRate: 0.8,
    };
    expect(deriveRobotPlan(params)).toEqual(deriveRobotPlan(params));
  });
});

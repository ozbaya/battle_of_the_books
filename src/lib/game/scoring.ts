import { SCORE } from './config';
import type { GameState, Player } from './types';

export function scoreAnswer(input: {
  titleCorrect: boolean;
  authorCorrect: boolean;
  recorded: boolean;
}): number {
  if (!input.recorded) return SCORE.NONE;
  if (!input.titleCorrect) return SCORE.WRONG;
  return input.authorCorrect ? SCORE.FULL : SCORE.TITLE_ONLY;
}

/**
 * For the title<->author flashcard quiz, which only ever asks for one field
 * at a time — there's no partial credit to work out, just right/wrong/
 * nothing recorded.
 */
export function scoreQuizAnswer(input: { correct: boolean; recorded: boolean }): number {
  if (!input.recorded) return SCORE.NONE;
  return input.correct ? SCORE.FULL : SCORE.WRONG;
}

/**
 * The only place scores are ever set. Replays `history` from scratch every
 * time, so it's pure and idempotent — used after every judged answer and
 * after an admin override, never incremented inline.
 */
export function recomputeScores(state: GameState): GameState {
  const players: Record<string, Player> = {};
  for (const id of Object.keys(state.players)) {
    const p = state.players[id];
    players[id] = { id: p.id, name: p.name, score: 0, full: 0, titleOnly: 0, wrong: 0, noAnswer: 0 };
  }

  let teamScore = 0;
  let robotScore = 0;

  for (const rec of state.history) {
    if (rec.by === 'robots') {
      robotScore += rec.points;
      continue;
    }

    const player = players[rec.by];
    if (player) {
      player.score += rec.points;
      if (rec.points === SCORE.FULL) player.full += 1;
      else if (rec.points === SCORE.TITLE_ONLY) player.titleOnly += 1;
      else if (rec.points === SCORE.WRONG) player.wrong += 1;
      else player.noAnswer += 1;
    }

    if (rec.countsForTeam) teamScore += rec.points;
  }

  return { ...state, players, teamScore, robotScore };
}

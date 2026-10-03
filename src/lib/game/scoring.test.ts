import { describe, expect, it } from 'vitest';
import { scoreQuizAnswer } from './scoring';

describe('scoreQuizAnswer', () => {
  it('scores 2 for a correct answer', () => {
    expect(scoreQuizAnswer({ correct: true, recorded: true })).toBe(2);
  });

  it('scores -0.5 for a recorded but wrong answer', () => {
    expect(scoreQuizAnswer({ correct: false, recorded: true })).toBe(-0.5);
  });

  it('scores 0 when nothing was recorded, regardless of correctness', () => {
    expect(scoreQuizAnswer({ correct: true, recorded: false })).toBe(0);
    expect(scoreQuizAnswer({ correct: false, recorded: false })).toBe(0);
  });
});

export type Difficulty = 'easy' | 'medium' | 'hard' | 'superDuperHard' | 'rishiMode';

export interface Question {
  question: string;
  title: string;
  author: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  full: number;
  titleOnly: number;
  wrong: number;
  noAnswer: number;
}

export interface KidAnswer {
  playerId: string;
  pressedAt: number;
  deadline: number;
  status: 'recording' | 'judging' | 'done';
  transcript?: string;
  titleCorrect?: boolean;
  authorCorrect?: boolean;
  points?: number;
  recorded?: boolean;
  needsReview?: boolean;
}

export interface AnswerRecord {
  questionIndex: number;
  by: 'robots' | string; // playerId
  transcript: string;
  titleCorrect: boolean;
  authorCorrect: boolean;
  points: number;
  isSteal: boolean;
  countsForTeam: boolean;
  recorded: boolean;
  needsReview?: boolean;
}

export interface RobotPlan {
  titleCorrect: boolean;
  authorCorrect: boolean;
  displayTitle: string;
  displayAuthor: string;
}

export interface LobbyPhase {
  name: 'LOBBY';
}

export interface GetReadyPhase {
  name: 'GET_READY';
  opensAt: number;
}

export interface KidsRoundPhase {
  name: 'KIDS_ROUND';
  isSteal: boolean;
  openedAt: number;
  /** Only set while robots are still armed (not a steal, no first respondent yet). */
  robotBuzzAt?: number;
  firstRespondent?: string;
  buttonsCloseAt?: number;
  answers: Record<string, KidAnswer>;
}

export interface RobotAnsweringPhase {
  name: 'ROBOT_ANSWERING';
  isSteal: boolean;
  buzzAt: number;
  revealAt: number;
  plan: RobotPlan;
}

export interface RevealPhase {
  name: 'REVEAL';
  nextAt: number;
}

export interface GameOverPhase {
  name: 'GAME_OVER';
}

export type Phase =
  | LobbyPhase
  | GetReadyPhase
  | KidsRoundPhase
  | RobotAnsweringPhase
  | RevealPhase
  | GameOverPhase;

export interface GameState {
  code: string;
  version: number;
  createdAt: number;
  /** Seeds every deterministic "random" decision the engine makes (robot plans, question order). */
  seed: number;
  /** Indices into the full question bank, sampled once at creation. */
  questionOrder: number[];
  currentIndex: number;
  numQuestions: number;
  difficulty: Difficulty;
  teamName: string;
  players: Record<string, Player>;
  teamScore: number;
  robotScore: number;
  phase: Phase;
  history: AnswerRecord[];
}

export type OverrideBucket = 'full' | 'titleOnly' | 'wrong' | 'none';

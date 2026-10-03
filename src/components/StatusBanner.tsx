'use client';

import type { PublicGameState } from '@/lib/game/engine';
import { Countdown } from './Countdown';

function playerName(state: PublicGameState, playerId: string | undefined): string {
  if (!playerId) return 'Someone';
  return state.players[playerId]?.name ?? 'Someone';
}

export function StatusBanner({ state, clockOffset }: { state: PublicGameState; clockOffset: number }) {
  const { phase } = state;

  if (phase.name === 'LOBBY') {
    const names = Object.values(state.players).map((p) => p.name);
    return (
      <Banner title="Waiting for players…">
        {names.length > 0 ? names.join(', ') : 'Join on your phone to get started!'}
      </Banner>
    );
  }

  if (phase.name === 'GET_READY') {
    return (
      <Banner title={`Question ${state.currentIndex + 1} of ${state.numQuestions}…`}>
        Get ready! <Countdown targetMs={phase.opensAt} clockOffset={clockOffset} />
      </Banner>
    );
  }

  if (phase.name === 'KIDS_ROUND') {
    if (phase.firstRespondent) {
      const others = Object.values(phase.answers).filter((a) => a.playerId !== phase.firstRespondent);
      return (
        <Banner title={`${playerName(state, phase.firstRespondent)} answered first for the team!`}>
          {others.length > 0 && `Others are still answering: `}
          {phase.buttonsCloseAt !== undefined && (
            <Countdown targetMs={phase.buttonsCloseAt} clockOffset={clockOffset} />
          )}
        </Banner>
      );
    }
    if (phase.isSteal) {
      return (
        <Banner title="🤖 The robots got it wrong!">
          Push the button if you know the answer! <Countdown targetMs={phase.openedAt} clockOffset={clockOffset} />
        </Banner>
      );
    }
    return <Banner title="Push the button if you know the answer!" />;
  }

  if (phase.name === 'ROBOT_ANSWERING') {
    return (
      <Banner title={phase.isSteal ? '🤖 Team Robo is trying to steal the points!' : '🤖 The robots pushed the button first!'}>
        Thinking… <Countdown targetMs={phase.revealAt} clockOffset={clockOffset} />
      </Banner>
    );
  }

  if (phase.name === 'REVEAL') {
    const questionRecords = state.history.filter((r) => r.questionIndex === state.currentIndex);
    return (
      <Banner title={state.correctAnswer ? `The answer was ${state.correctAnswer.title} by ${state.correctAnswer.author}` : 'Reveal!'}>
        {questionRecords.map((r, i) => (
          <div key={i}>
            {r.by === 'robots' ? '🤖 Team Robo' : playerName(state, r.by)}: {r.points > 0 ? '✅' : '❌'} {r.points > 0 ? `+${r.points}` : r.points}
          </div>
        ))}
        Next question in <Countdown targetMs={phase.nextAt} clockOffset={clockOffset} />
      </Banner>
    );
  }

  // GAME_OVER
  const winner = state.teamScore === state.robotScore ? 'tie' : state.teamScore > state.robotScore ? 'team' : 'robots';
  return (
    <Banner title={winner === 'tie' ? "It's a tie!" : winner === 'team' ? `${state.teamName} wins! 🎉` : '🤖 The robots win this time!'}>
      Final score: {state.teamName} {state.teamScore} — {state.robotScore} 🤖 Team Robo
    </Banner>
  );
}

function Banner({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/5 px-6 py-4 text-center dark:bg-white/10">
      <div className="text-[clamp(1.25rem,4vw,2.5rem)] font-extrabold leading-tight">{title}</div>
      {children && <div className="mt-1 text-[clamp(0.9rem,2.2vw,1.25rem)] opacity-80">{children}</div>}
    </div>
  );
}

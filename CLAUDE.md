# Battle of the Books Trainer — CLAUDE.md

A Next.js + Tailwind CSS web app, deployed on Vercel and playable on phones (landscape-first), tablets and laptops,
that lets a group of kids practice for Battle of the Books by competing as a team against
an imaginary team of robots. Kids join from their own phones/tablets, press a button, speak
their answer (≤ 5 s), and the answer is transcribed with OpenAI Whisper and judged by the
OpenAI API. Once the admin starts a game, it runs by itself question after question.

This file is the source of truth for **what** to build and **how**. When requirements here
conflict with a later instruction from the user, follow the user and update this file.

---

## 1. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | Use the latest stable `create-next-app`. Read the installed version's docs before using version-specific APIs (e.g. route `params` are async `Promise`s in Next 15+). |
| Styling | Tailwind CSS (v4) | v4 style: `@import "tailwindcss";` in `globals.css`, `@tailwindcss/postcss` plugin, no `tailwind.config.js` unless a customization needs it. |
| Hosting | Vercel | Serverless functions only — **no long-running processes, no WebSockets, no server timers**. |
| Shared game state | Upstash Redis (via Vercel Marketplace) | `@upstash/redis`. In-memory fallback for local dev (see §9). |
| Real-time updates | Short polling, phase-aware cadence (1 s during active answering phases, 2.5 s during quiet ones like LOBBY/REVEAL) | Simple and Vercel-friendly; the store layer also skips writing back to Redis when a poll finds nothing changed, to keep Redis command volume (and therefore quota/cost) down. Upgrade path: Ably or Pusher for push events if polling feels laggy. |
| Speech-to-text | OpenAI transcription API, model `whisper-1` | Hosted Whisper. Model name configurable via `OPENAI_TRANSCRIBE_MODEL`. |
| Answer judging | OpenAI chat/Responses API with structured JSON output | Model configurable via `OPENAI_JUDGE_MODEL` (default to a small, fast model, e.g. `gpt-4o-mini`). |
| Audio capture | Browser `MediaRecorder` | Requires HTTPS (Vercel provides it; `localhost` is also allowed). Starting point: `reference/audio-recording-reference.js` (see §6). |
| Tests | Vitest | Pure game logic must be unit-tested. |

### Bootstrapping

This folder already contains `CLAUDE.md` and `reference/`, and `create-next-app` refuses to
scaffold into a non-empty directory. Scaffold into a temp folder and move the files in:

```bash
npx create-next-app@latest tmp-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
mv tmp-app/* tmp-app/.[!.]* . && rmdir tmp-app
npm install @upstash/redis openai zod nanoid
npm install -D vitest
```

Add scripts: `"test": "vitest"`, keep `dev`, `build`, `start`, `lint`. Exclude `reference/`
from the TypeScript build and lint (it's plain browser JS kept for reference only).

---

## 2. Screens & routes

All game URLs are keyed by a short, kid-friendly **game code** (e.g. `OWL42`).

| Route | Who uses it | Purpose |
|---|---|---|
| `/admin` | Parent (password protected) | Create game (team name, difficulty, **number of questions**), start game, end game, override a judgment. The admin does **not** advance questions. |
| `/play/[code]` | Each kid, on own phone, tablet or laptop — this is the "team link" | Enter name → mic permission + quick mic check → lobby → big ANSWER button → tap to record ≤ 5 s (mic is off otherwise) → see own result and score. |
| `/screen/[code]` | TV / laptop on the big screen | Shows current question, a big status banner telling the kids what's happening, countdowns, the robots' answer, each kid's result, the correct answer on reveal. Shows join QR code + player names in the lobby. |
| `/scores/[code]` | Second screen (or a tab on the big screen) | Team scores (Kids vs Robots) and each kid's individual score + stats. |

### Big-screen status messages (examples — short, big, fun)

- Lobby: "Waiting for players… Join at **<url>** — code **OWL42**" + list of joined names
- Before each question: "Question 3 of 10… Get ready! 3 · 2 · 1"
- Question open: "Push the button if you know the answer!" (robot timing is NOT shown — it should be a surprise)
- Kids answering: "**Maya** answered first for the team! 🎙️ Leo is recording… Sam is being checked…" + "Others can still answer: 7 s"
- Kid results (per kid, as they arrive): "✅ Maya: book AND author! +2" / "✅ Leo: book! +1" / "❌ Sam: not quite. −0.5" / "Ava didn't record — 0"
- Team result: "Team answer (Maya): correct! +2 for the team"
- Robots buzzed: "🤖 The robots pushed the button first!" → "Robots say: *'Holes by Louis Sachar'*"
- Robots wrong: "🤖 The robots got it wrong! Push the button if you know the answer!" + steal countdown
- Robots stealing: "Team answer was wrong… 🤖 the robots get a chance to steal!"
- Reveal: "The answer was **Holes** by **Louis Sachar**" + points this question + "Next question in 6 s"
- Game over: winner banner + link to final scores

---

## 3. Game rules (implement exactly)

### Teams
- **Kids team**: all players who joined via `/play/[code]`. One human team per game.
- **Robots team**: simulated. Never "joins"; driven by the server state machine.

### Scoring (applies to every answer, kid or robot)
| Outcome | Points |
|---|---|
| Correct book title **and** correct author | **+2** |
| Correct book title, author wrong or missing | **+1** |
| Recorded an answer, title wrong (anything else) | **−0.5** |
| Pressed the button but recorded nothing (no audio arrived, cancelled, or empty/silent transcript) | **0** |
| Didn't press the button | **0** (not counted as an attempt) |

### Every kid may answer; only the first counts for the team
- **Every kid may record an answer on every question, independently of what their friends do.** Each kid gets at most one answer per question.
- **Individual score** = sum of that kid's own answer points across the game. Also track counts per kid: full-correct, title-only, wrong, pressed-but-no-answer.
- **Team score**: on each question, the team receives the points of its **first respondent only** — the kid whose button press reached the server first. Other kids' answers affect only their individual scores.
- The first respondent's result decides the team's outcome (e.g. whether the robots get to steal), even if a later kid answered correctly.
- **Robots** are scored with the same table, into the robot team score.

### The answer button (each kid's phone)
- Tapping is **optional**. A kid who never taps on a question gets 0 and it isn't counted as an attempt.
- **One tap per question.** The tap itself starts the recording; the kid then has **5 seconds** to say the answer out loud (auto-stop at 5 s; a "Done" button may end it early). After the tap, the button stays disabled for the rest of the question and shows that kid's status/result.
- Button enabled/disabled rules for a kid who hasn't tapped yet this question:

| Situation | Button |
|---|---|
| "Get ready" countdown | Disabled |
| Question on screen, robots haven't picked it up | **Enabled** |
| Robots picked it up first (thinking / giving their answer) | **Disabled** ("The robots are answering…") |
| Robots answered **incorrectly** | **Enabled again** (steal) — still only if this kid hasn't tapped this question |
| Robots answered correctly | Stays disabled until the next question |
| A teammate tapped first | Stays enabled until the follow-up window closes (see below), so friends can still answer |
| Reveal / game over | Disabled |
| Next question arrives | **Enabled again** for everyone (one fresh tap each) |

- Because a kid's tap before the robots blocks the robots, a kid who has already tapped can never also be in a robot steal on the same question — "one tap per question" always holds.

### Turn flow per question (no admin involvement)
1. **Get ready** (3 s countdown), then the question appears on the big screen and every kid's button goes live. The robots are armed to buzz at `questionOpenedAt + robotDelay`.
2. **If a kid taps first** (before the robots), the team has claimed the question and the robots stand down. That kid is the team's first respondent. **Every other kid who hasn't tapped can still tap and record for `FOLLOW_UP_WINDOW` (default 10 s) after the first tap** — this window is the only extra reason the button closes, so the game can move on. Each recording is transcribed, judged and scored individually.
   - When the window has closed and every pending answer is judged (or past its deadline):
     - First respondent correct (+1 or +2) → team gets those points → **Reveal**.
     - First respondent wrong / no answer → team gets −0.5 / 0 → **robots get a steal attempt** (they answer after `robotDelay`, correct or wrong per their accuracy) → **Reveal**.
3. **If the robots buzz first**: all kids' buttons lock; robots "think" ~2.5 s, then their answer is shown.
   - Correct → robots score → **Reveal**. Kids get no attempt on this question (0 points each).
   - Wrong → robots get −0.5; **kids' buttons re-open (steal)** for `STEAL_WINDOW` (default 10 s). Same rules as step 2: every kid may answer, the first press is the team's answer, the follow-up window applies. There is no further robot steal. If nobody presses before the steal window ends → **Reveal**.
4. **Reveal** shows the correct answer and this question's points for ~`REVEAL_DURATION` (default 6 s), then the next question starts **automatically**.
5. After the last question (admin-set count) → **Game over** automatically. The admin can also end the game early.

### Robots
- **Difficulty = robot response time** (for both first buzz and steals):
  - Easy: **7 s**
  - Medium: **5 s**
  - Hard: **5 s**
  - Super Duper Hard: **4 s**
- Robot accuracy is fixed for now (`ROBOT_ACCURACY`, default 0.6 correct; of correct answers, ~80% include the author). Keep accuracy in the difficulty config object so it can vary by difficulty later.
- Robot answer outcomes (first attempt and steal) are decided (seeded random) **when the question opens** and stored in state, so they are deterministic across serverless invocations.
- Robot answers are displayed as text: correct → the real title/author; wrong → a different book/author from the same question set as the game (see below).
- **Hard and Super Duper Hard each swap the question set**, not just the robot timing: a Hard game draws its questions from `questions/hard.md`, a Super Duper Hard game from `questions/"super duper hard.md"` (same table format, admin-authored, filled with harder/more obscure questions) — instead of `questions/questions.md`. Easy and Medium use the standard set. `questionSetForDifficulty()` in `lib/questions.ts` is the single mapping from difficulty to file; every route that loads a game's questions derives the set from the game's own stored `difficulty` after loading state (never guesses it up front), so mid-game question-bank consistency holds regardless of which request happens to advance the game.

### Assumptions (confirm with the user if behavior seems off)
- Robots get a steal attempt when the team's first respondent is wrong or doesn't record (symmetry with the kids' steal).
- An author answer counts if the last name is right (e.g. "Sachar"). Make this a judge-prompt setting.
- No reading time before buttons go live beyond the 3 s "get ready" countdown; the robot timer starts when the question appears.

---

## 4. Architecture

### 4.1 Serverless-safe state machine (the key design decision)
Vercel functions can't run timers, so **every time-based transition is computed lazily** —
this is also what makes the game advance with no admin input:

- All game state lives in one JSON document per game in Redis (`game:{code}`), with a `version` number.
- A **pure function** `advance(state, now): GameState` applies every transition whose deadline has passed (get-ready → open, robot buzz, robot reveal, follow-up window close, answer deadlines, steal window close, reveal → next question, last reveal → game over). It loops until no more transitions apply, and has no I/O.
- Every API call (including state polls from the big screen and phones) does: load → `advance(state, serverNow)` → apply the action → save with **compare-and-swap** on `version` (Lua `EVAL` script in Upstash; retry up to 5× on conflict). Because screens poll constantly, the game always moves forward on time.
- Button races are resolved by the CAS: the first press that the server applies becomes the team's first respondent; robots lose if any kid's press is applied before `robotBuzzAt`. Because `advance` runs first, a press received after `robotBuzzAt` loses to the robots — **server time is the only clock that matters**.
- Every state response includes `serverNow` so clients can compute countdowns from a clock offset rather than their own clocks.

### 4.2 Phases
```
LOBBY
  └─(admin start)──────────> GET_READY { opensAt = now + 3 s }
GET_READY
  └─ now ≥ opensAt ────────> KIDS_ROUND { isSteal: false, openedAt, robotBuzzAt, robotPlan }
KIDS_ROUND { isSteal, openedAt, firstRespondent?, buttonsCloseAt?, answers: {playerId → KidAnswer} }
  ├─ first kid press ──────> set firstRespondent; buttonsCloseAt = press + FOLLOW_UP_WINDOW; robots disarmed
  ├─ more kid presses ─────> allowed until buttonsCloseAt (one per kid)
  ├─ no press & !isSteal & now ≥ robotBuzzAt ─> ROBOT_ANSWERING { isSteal: false }
  ├─ no press & isSteal & now ≥ openedAt + STEAL_WINDOW ─> REVEAL
  └─ now ≥ buttonsCloseAt AND all answers resolved ─>
        first respondent correct ─> REVEAL
        else !isSteal ───────────> ROBOT_ANSWERING { isSteal: true, buzzAt = now + robotDelay }
        else ────────────────────> REVEAL
ROBOT_ANSWERING { isSteal, buzzAt, revealAt = buzzAt + 2.5 s }
  └─ now ≥ revealAt ──────> correct → REVEAL ; wrong & !isSteal → KIDS_ROUND { isSteal: true } ; else REVEAL
REVEAL { nextAt = now + REVEAL_DURATION }
  └─ now ≥ nextAt ────────> more questions ? GET_READY : GAME_OVER
Any phase ─(admin end)───> GAME_OVER
```
`KidAnswer` = `{ pressedAt, deadline, status: 'recording' | 'judging' | 'done', transcript?, titleCorrect?, authorCorrect?, points? }`.
`deadline` = `pressedAt + 5 s recording + ~8 s upload/transcribe grace`; past the deadline with no audio → 0 points.
Keep every duration in one `config.ts`.

### 4.3 State shape (sketch)
```ts
type Difficulty = 'easy' | 'medium' | 'hard';
interface Player { id: string; name: string; score: number; full: number; titleOnly: number; wrong: number; noAnswer: number; }
interface AnswerRecord { questionIndex: number; by: 'robots' | string /* playerId */; transcript: string;
  titleCorrect: boolean; authorCorrect: boolean; points: number; isSteal: boolean; countsForTeam: boolean; }
interface GameState {
  code: string; version: number; createdAt: number;
  questionOrder: number[];        // random selection of `numQuestions` rows from the questions file
  currentIndex: number; numQuestions: number;
  difficulty: Difficulty; teamName: string;
  players: Record<string, Player>;
  teamScore: number; robotScore: number;
  phase: Phase; phaseData: /* discriminated union per phase */ unknown;
  history: AnswerRecord[];        // scores must be re-derivable from history (admin overrides)
}
```
Never send the correct answer to `/play` or `/screen` clients before `REVEAL` — strip it in the state API response.

### 4.4 Directory layout
```
questions/questions.md         # the question file the admin edits: Markdown table (committed to the repo)
reference/audio-recording-reference.js   # user-supplied recording code, reference only
src/
  app/
    admin/page.tsx
    play/[code]/page.tsx
    screen/[code]/page.tsx
    scores/[code]/page.tsx
    api/
      admin/login/route.ts
      admin/games/route.ts            # POST create, GET list
      admin/games/[code]/route.ts     # POST {action: start|end|override}
      games/[code]/state/route.ts     # GET (polled by everyone; drives auto-advance)
      games/[code]/join/route.ts      # POST {name} → {playerId}
      games/[code]/press/route.ts     # POST {playerId} → {accepted, isFirstRespondent}
      games/[code]/answer/route.ts    # POST multipart audio → transcribe → judge → score
  lib/
    game/config.ts       # durations, difficulty table, robot accuracy, scoring table
    game/types.ts
    game/engine.ts       # PURE: advance(), applyPress(), applyJudgment(), scoreAnswer(), recomputeScores()
    game/engine.test.ts
    store/index.ts       # getGame/updateGame(code, fn) with CAS; picks redis or memory
    store/redis.ts
    store/memory.ts      # globalThis Map for local dev / tests
    questions.ts         # parse the Markdown table + validate with zod
    ai/transcribe.ts
    ai/judge.ts
    audio/recorder.ts    # TypeScript port of the reference recorder (see §6)
  components/            # AnswerButton, StatusBanner, Countdown, Scoreboard, MicCheck, JoinQR
```

---

## 5. Questions file (v1)

For the first version the admin edits **one Markdown file, `questions/questions.md`**, in the
repo and redeploys (push to GitHub → Vercel builds). No upload/editing UI in v1.

The file holds a standard Markdown table with exactly three columns — **Question**,
**Book Title**, **Author** — in that order. Anything outside the table (a title, notes) is ignored.

```markdown
# Battle of the Books questions

| Question | Book Title | Author |
|---|---|---|
| In which book does a boy dig holes at a camp in the desert? | Holes | Louis Sachar |
| In which book does a spider write words in her web? | Charlotte's Web | E.B. White |
```

Parsing (`lib/questions.ts`):
- Read the file server-side with `fs` (resolve from `process.cwd()`); make sure it is bundled into the Vercel functions (e.g. `outputFileTracingIncludes` in `next.config` for the API routes), or import it at build time.
- Find the first table whose header row matches `Question | Book Title | Author` (case-insensitive, trimmed). Skip the header and the `|---|` separator row; every following row starting with `|` is a question, until the first non-table line.
- Split rows on unescaped `|` (allow `\|` inside a cell for a literal pipe), trim cells, strip leading/trailing pipes, and strip simple Markdown emphasis (`*`, `_`, backticks) from cells.
- Validate with zod: all three cells non-empty. On a bad row, fail loudly with the line number and the row text, so the admin can see what to fix.
- No alternate-spelling columns: the judge (§6) handles variants like "Charlottes Web" or "EB White".
- Ship the file with ~10 well-known books so the app works out of the box.
- **The admin sets the number of questions** when creating a game (required; 1 … number of rows, default 10 or all if fewer). The game picks that many distinct questions at random.

### 5.1 Hard / Super Duper Hard question sets

Two further optional files, same format and parsing as above, admin-authored:
**`questions/hard.md`** and **`questions/"super duper hard.md"`** (the latter's filename has
spaces — quote it in shell commands). Used wherever that difficulty is chosen:
- **Team games**: picking Hard or Super Duper Hard at game creation uses the matching file for
  that game's entire question bank instead of `questions.md`; Easy/Medium are unaffected.
- **Practice** (solo mode, §10+): a Normal/Hard/Super Duper Hard toggle on its start screen, each
  harder option only shown once its file has at least one row (hidden otherwise, via
  `/api/practice/questions`'s `hardAvailable`/`superDuperHardAvailable` flags). Super Duper Hard
  rounds also score 3x (vs. 2x for Hard, 1x standard) in the home page leaderboard
  (`lib/leaderboard.ts`).
  **Quiz mode has no difficulty toggle** — it always quizzes the standard title/author pairs from
  `questions.md`, by design.

`questionSetForDifficulty()` / the `QuestionSet` type in `lib/questions.ts` is the single mapping
difficulty → file. Ships as an empty placeholder (header only) until the admin fills it in.

---

## 6. Audio, transcription & judging

### Recording (client, `/play/[code]`)
**The recorder only records when the answer button is tapped. It is inactive at all other
times:** no open microphone, no `MediaRecorder`, no audio captured, buffered or sent between
taps. The browser's "microphone in use" indicator should only appear during a 5-second answer.

Port `reference/audio-recording-reference.js` (the user's existing recorder) to a typed
`lib/audio/recorder.ts` + a React `AnswerButton` component. Keep its overall structure: it
already opens the mic on start and stops all tracks on stop/cancel, which matches the
requirement above. Keep its start / stop / cancel flow, its error handling by `error.name`, and
its browser-not-supported message. Change these things:
- **Permission up front, mic off afterwards.** On the "Join" tap (a user gesture, needed by iOS Safari), call `getUserMedia` once to get permission and run a quick "say something" level-meter mic check, then **stop all tracks immediately**. Each answer tap then calls `getUserMedia` again, records, and stops all tracks when done (as the reference does), so the mic is off between answers.
- **The 5 seconds start when recording actually starts** (after `getUserMedia` resolves and `MediaRecorder.start()` fires `onstart`), not at the moment of the tap, so a slow mic start never cuts the kid off.
- **5-second limit**, not 1 hour: auto-stop at 5.0 s with a shrinking ring / big countdown (replace the `hh:mm:ss` elapsed-time logic). The kid may tap "Done" earlier.
- **Upload instead of playback**: replace `playAudio` (FileReader → base64 → `<audio>`) with a `multipart/form-data` POST of the Blob to `/api/games/[code]/answer` with `playerId`. No playback.
- **Pick a supported mime type**: try `audio/webm;codecs=opus`, then `audio/mp4` (Safari), via `MediaRecorder.isTypeSupported`; pass it to the constructor. Name the uploaded file with the matching extension (`answer.webm` / `answer.m4a`) — Whisper uses the extension.
- **Tap flow**: on `pointerdown`, POST `/press` and start the mic at the same time (don't wait for the server, to save time). If the press is rejected (button closed, robots got it first, already tapped), cancel immediately, stop the tracks, and discard — nothing is uploaded. Cancel or no audio after an accepted press = 0 points.
- Show each error case (permission denied, no mic, unsupported browser) as a friendly on-screen message for kids instead of `console.log`.
- iOS caveat: if testing shows Safari re-prompting for the mic on every tap, keep the per-tap approach but tell the user; don't silently switch to an always-open mic.
- A 5 s clip is well under Vercel's 4.5 MB request body limit.

### Pipeline for every recording (server, `/api/games/[code]/answer`)
Every recording that arrives goes through the same two OpenAI steps, then the score is applied:
1. **Transcribe** with the OpenAI Whisper API.
2. **Evaluate** the transcript with the OpenAI API (lenient grading, below).
3. **Score** with `scoreAnswer()` in `engine.ts` and save it to the game state with CAS.

Route handlers that call OpenAI: `export const runtime = 'nodejs'`, and set `maxDuration`
generously (e.g. 30). Several kids may submit at once; each `/answer` request is independent,
and only the final state write goes through CAS. The OpenAI key is used only on the server.

### Transcription (`lib/ai/transcribe.ts`)
- `openai.audio.transcriptions.create({ file, model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1', language: 'en', prompt })`.
- Pass a `prompt` listing the titles and authors from `questions/questions.md` — this strongly improves spelling of book names. Don't single out the correct answer.
- An empty or whitespace-only transcript means nothing was said → 0 points (no evaluation call).

### Evaluation — lenient grading (`lib/ai/judge.ts`)
- Input: the question, the expected book title and author, and the transcript. Output (structured JSON, validated with zod): `{ titleCorrect: boolean, authorCorrect: boolean, reason: string }`.
- **Grade leniently.** The transcript comes from a child speaking quickly and was produced by speech-to-text, which may have made mistakes. The judge prompt must say this and tell the model to give credit whenever the kid most likely said the right answer:
  - Accept misheard or misspelled words that sound like the right title or author ("Charlotte's Web" ↔ "Charlottes Web" ↔ "Sharlot's Web"; "Louis Sachar" ↔ "Lewis Sacker").
  - Ignore missing or extra articles ("The", "A"), punctuation, apostrophes, capitalization, initials ("E.B. White" ↔ "EB White" ↔ "E White"), and filler words ("um", "I think it's…", "by").
  - Accept a clearly identifiable partial title (e.g. "Wimpy Kid" for "Diary of a Wimpy Kid") and the author's last name alone.
  - Title and author can be in any order.
  - Still mark it wrong when it is plainly a different book, or when only the author is right (title wrong = wrong, per §3).
  - When unsure, lean toward giving credit.
- Fast path: if a normalized fuzzy match already clearly contains the title (and author), skip the LLM call and mark it correct. Never use fuzzy matching to mark something *wrong*; send unclear cases to the LLM.
- Keep the prompt and a handful of example transcripts in `lib/ai/judge.ts`, and add unit tests for the fast path plus a small optional (skipped in CI) live test set of tricky transcripts.
- On an OpenAI error, don't stall the game: score the answer as "needs review" (0 for now), keep the game moving, and let the admin fix it from `/admin`.
- `scoreAnswer({ titleCorrect, authorCorrect, recorded })` maps to points per §3. The LLM never computes points.

---

## 7. Admin

- Protected by `ADMIN_PASSWORD` env var: `/api/admin/login` sets an httpOnly signed cookie; all `/api/admin/*` routes check it.
- **Create game**: team name, difficulty (Easy 7 s / Medium 5 s / Hard 5 s / Super Duper Hard 4 s — Hard and Super Duper Hard each also drawing questions from their own harder file, §5.1), **number of questions**. Returns the game code and links to `/play`, `/screen`, `/scores`.
- **Start game** (from the lobby, once the kids have joined) and **End game** (moves to `GAME_OVER` immediately). Everything in between runs automatically — no "next question" button.
- **Override judgment**: lists answers (current and past questions) with transcript + verdict and buttons **Full (+2) / Title (+1) / Wrong (−0.5) / No answer (0)** to fix mis-transcriptions. Overrides recompute individual and team scores from `history`.
- List of recent games; games expire from Redis after 24 h (`EX`).

---

## 8. UI guidelines

- Audience is kids on phones/tablets plus a TV. Big type, high contrast, huge tap targets, playful colors. The ANSWER button should dominate the phone screen and clearly show states: *ready* (bright), *locked* (grey, with reason: "Robots are answering…", "Wait for the next question"), *recording* (pulsing red + 5 s countdown ring), *checking* (spinner), *result* (green/red with points), *already answered* (disabled, shows own result until the next question). Follow the enabled/disabled table in §3 exactly; the server's state decides, the client only renders it.
- **Players can use a phone, a tablet or a laptop, and each gets a layout tuned for it** (see "Device-optimized layouts" below). The same pages and components serve all three. Never ship a separate "mobile site"; adapt with responsive Tailwind variants.

### Device-optimized layouts

Pick layouts from **viewport size and input type**, not user-agent sniffing. Define these Tailwind v4 custom variants in `globals.css` (via `@custom-variant`) and use them alongside the built-in `sm/md/lg/xl`, `landscape:` and `portrait:`:
- `touch`: `@media (pointer: coarse)` (phones, tablets)
- `mouse`: `@media (pointer: fine) and (hover: hover)` (laptops)
- `short`: `@media (max-height: 480px)` (phones in landscape)

| | Phone | Tablet | Laptop |
|---|---|---|---|
| Typical viewport | 640–932 × 320–430 landscape; 360–430 × 640–932 portrait | 768–1366 wide, either orientation | 1280–1920 × 720–1080 |
| Preferred orientation | **Landscape** (first-class); portrait must still work | Either, both polished | Landscape window, resizable |
| `/play` layout | Landscape: two columns, answer button on one side (sized to the short edge, thumb-reachable), question/status/score on the other. Portrait: stacked, button in the bottom half. | Landscape: two columns with the question large enough to read comfortably. Portrait: question on top, large button below. | Centered card (max width ~1000 px), question large, button big but not full-screen; status and score beside it. |
| Answer input | Tap (`pointerdown`) | Tap (`pointerdown`) | Click **or keyboard**: **Space/Enter** = tap (ignore key auto-repeat, `event.repeat`), **Esc** = cancel the recording; show a "Press Space to answer" hint only on `mouse` devices |
| Answer button size | Fills ~45% of the screen width in landscape | ≥ 240 px | ≥ 200 px, with visible hover and focus rings |
| Type scale | Compact; `short:` variant shrinks headings/padding; question via `clamp()` | Medium-large | Large question text, generous spacing |
| Other | `100dvh`, safe-area insets, "turn your phone sideways" hint in portrait | `100dvh`, safe-area insets | Works in a normal browser window down to ~1024 px wide without scrolling |

Rules for all devices:
- **No scrolling during play** on `/play` at any of the viewports above; the button must always be visible without scrolling.
- Use `100dvh` (not `100vh`) so mobile/tablet browser toolbars don't push the button off-screen, and respect notches with `env(safe-area-inset-*)` padding (`viewport-fit=cover` in the viewport metadata).
- Don't rely on locking orientation (iOS Safari ignores `screen.orientation.lock`).
- On touch devices disable accidental zoom/selection on the button (`touch-action: manipulation`, `select-none`) and respond on `pointerdown`, not `click`, so tapping is instant.
- Laptops: the browser's mic permission prompt and indicator differ from phones; the mic check on join must work with built-in and external mics. Keyboard focus starts on the answer button once the game begins.
- The same device rules apply to `/screen` and `/scores` (a laptop or tablet may be the big screen, and a phone may be the only screen available), but those pages are optimized first for a laptop/TV in landscape.
- **Verify every page before calling a milestone done**, in Chrome DevTools device emulation and by resizing a desktop window:
  - Phone: iPhone SE 667×375 and a large phone 932×430 in landscape, plus 390×844 portrait.
  - Tablet: iPad 1024×768 landscape and 768×1024 portrait.
  - Laptop: 1280×800 and 1920×1080, mouse and keyboard only.
- Big screen must be readable from across a room: question text ≥ 48 px, status banner ≥ 64 px, teams shown as "<Team name> vs 🤖 Robots", and a live row of kid chips showing each kid's status this question (waiting / recording / checking / ✅ +2 / ❌ −0.5).
- Optional sound effects on the big screen (button press, correct, wrong) — browsers need one click on the page first to allow audio.
- Robots: give them personality (emoji avatar, name like "Team Robo"), but never anything scary.
- Use Tailwind utilities; extract components rather than long repeated class strings. No component library needed.

---

## 9. Environment variables

| Name | Purpose |
|---|---|
| `OPENAI_API_KEY` | Transcription + judging. **Server only** — never prefix with `NEXT_PUBLIC_`. |
| `OPENAI_TRANSCRIBE_MODEL` | Default `whisper-1`. |
| `OPENAI_JUDGE_MODEL` | Default small fast model, e.g. `gpt-4o-mini`. |
| `ADMIN_PASSWORD` | Admin login. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Redis. The Vercel Marketplace integration may inject `KV_REST_API_URL` / `KV_REST_API_TOKEN` instead — accept either. |
| `STORE` | `memory` to use the in-memory store (default when no Redis vars are set). |
| `MOCK_AI` | `true` → skip OpenAI: the play page shows a text box instead of recording, and the judge uses fuzzy matching only. For local testing without a mic or API key. |

Keep a committed `.env.example`; `.env.local` is git-ignored.

---

## 10. Build order (milestones)

1. Scaffold (§1), `config.ts`, `types.ts`, Markdown-table loader (with unit tests for malformed rows) + starter `questions/questions.md`.
2. **Pure engine** (`engine.ts`) with thorough Vitest coverage, using fake `now` values (never real timers):
   scoring table; every kid may answer once; team gets only the first respondent's points; follow-up window;
   robot buzz timing per difficulty; robots lose to an earlier kid press; robot steal after a wrong/no-answer
   first respondent; kids' steal after a wrong robot answer; answer deadline → 0; auto-advance through
   reveal → next question → game over after `numQuestions`; admin end; override recomputation.
3. Store layer: memory store, then Redis store with CAS + retry.
4. API routes (join, state, press, admin actions) with `MOCK_AI=true` answers.
5. Pages: `/admin`, `/play`, `/screen`, `/scores` with a polling hook `useGameState(code)` (phase-aware cadence, pauses when tab hidden).
6. Real audio: port the reference recorder (§6) with the mic off except during a tapped answer, `/answer` route, Whisper transcription + lenient OpenAI evaluation.
7. Polish: big-screen messages, kid status chips, sounds, QR code, admin override UI, device pass (phone / tablet / laptop, §8).
8. Deploy to Vercel (add Upstash Redis from the Marketplace, set env vars), then test end-to-end with real devices — at least one iPhone in landscape, one tablet, and one laptop — with several kids answering the same question.

## 11. Commands & conventions

- `npm run dev` — local dev (memory store, works without Redis). Testing on phones over the LAN needs HTTPS for the mic; use `next dev --experimental-https` or a Vercel preview deploy.
- `npm test` — must pass before deploying. `npm run lint` and `npm run build` must be clean.
- TypeScript strict mode; validate all request bodies with zod.
- Keep game logic in `lib/game/engine.ts` pure and fully tested; route handlers stay thin.
- Never trust the client for timing, scoring, or who pressed first.

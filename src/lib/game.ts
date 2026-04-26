// Shared game types & helpers
export type SessionStatus = "lobby" | "question" | "reveal" | "finished";

export interface QuestionWithAnswers {
  id: string;
  question_text: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  order_index: number;
  is_poll: boolean;
  answers: AnswerRow[];
}

export interface AnswerRow {
  id: string;
  answer_text: string;
  is_correct: boolean;
  color_index: number;
  order_index: number;
}

export const ANSWER_BG = ["bg-answer-1", "bg-answer-2", "bg-answer-3", "bg-answer-4"];
export const ANSWER_FG = ["text-answer-1-foreground", "text-answer-2-foreground", "text-answer-3-foreground", "text-answer-4-foreground"];
export const ANSWER_SHAPES = ["▲", "◆", "●", "■"];

const PLAYER_KEY = (sessionId: string) => `quizpop:player:${sessionId}`;

export function savePlayerId(sessionId: string, playerId: string) {
  try { localStorage.setItem(PLAYER_KEY(sessionId), playerId); } catch { /* ignore */ }
}
export function loadPlayerId(sessionId: string): string | null {
  try { return localStorage.getItem(PLAYER_KEY(sessionId)); } catch { return null; }
}
export function clearPlayerId(sessionId: string) {
  try { localStorage.removeItem(PLAYER_KEY(sessionId)); } catch { /* ignore */ }
}

export function computePoints(basePoints: number, responseMs: number, timeLimitSec: number): number {
  const ratio = Math.max(0, 1 - responseMs / (timeLimitSec * 1000));
  // Speed bonus: 50% base for time, 50% flat
  return Math.round(basePoints * (0.5 + 0.5 * ratio));
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ANSWER_BG, ANSWER_SHAPES, type QuestionWithAnswers, type SessionStatus } from "@/lib/game";
import { Play, SkipForward, Trophy, Users } from "lucide-react";

export const Route = createFileRoute("/host/$sessionId")({
  component: HostView,
});

interface SessionRow {
  id: string;
  pin: string;
  quiz_id: string;
  host_id: string;
  status: SessionStatus;
  current_question_index: number;
  question_started_at: string | null;
}

interface PlayerRow {
  id: string;
  nickname: string;
  score: number;
}

function HostView() {
  const { sessionId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionRow | null>(null);
  const [questions, setQuestions] = useState<QuestionWithAnswers[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [answersCount, setAnswersCount] = useState(0);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [user, authLoading, navigate]);

  // initial load
  useEffect(() => {
    (async () => {
      const { data: s, error } = await supabase
        .from("game_sessions").select("*").eq("id", sessionId).single();
      if (error || !s) { toast.error("Session not found"); navigate({ to: "/dashboard" }); return; }
      setSession(s as SessionRow);
      const { data: qs } = await supabase
        .from("questions").select("*, answers(*)").eq("quiz_id", s.quiz_id).order("order_index");
      setQuestions(((qs ?? []) as unknown as QuestionWithAnswers[]).map((q) => ({
        ...q,
        answers: [...q.answers].sort((a, b) => a.order_index - b.order_index),
      })));
      const { data: ps } = await supabase
        .from("players").select("id, nickname, score").eq("session_id", sessionId).order("score", { ascending: false });
      setPlayers((ps as PlayerRow[]) ?? []);
    })();
  }, [sessionId, navigate]);

  // realtime: players + session
  useEffect(() => {
    const ch = supabase
      .channel(`host-${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `session_id=eq.${sessionId}` }, async () => {
        const { data } = await supabase.from("players").select("id, nickname, score").eq("session_id", sessionId).order("score", { ascending: false });
        setPlayers((data as PlayerRow[]) ?? []);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` }, (p) => {
        setSession(p.new as SessionRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId]);

  // realtime: answers count for current question
  const currentQuestion = useMemo(() => questions[session?.current_question_index ?? 0], [questions, session]);
  useEffect(() => {
    if (!currentQuestion || session?.status !== "question") { setAnswersCount(0); return; }
    let cancelled = false;
    const fetchCount = async () => {
      const { count } = await supabase.from("player_answers")
        .select("id", { count: "exact", head: true })
        .eq("question_id", currentQuestion.id)
        .in("player_id", players.map((p) => p.id).length ? players.map((p) => p.id) : [""]);
      if (!cancelled) setAnswersCount(count ?? 0);
    };
    fetchCount();
    const ch = supabase
      .channel(`host-ans-${currentQuestion.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "player_answers", filter: `question_id=eq.${currentQuestion.id}` }, fetchCount)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [currentQuestion, session?.status, players]);

  // ticker
  useEffect(() => {
    if (session?.status !== "question") return;
    tickRef.current = window.setInterval(() => setNow(Date.now()), 250);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [session?.status]);

  // auto-reveal when timer hits 0
  const timeLeft = useMemo(() => {
    if (!session?.question_started_at || !currentQuestion) return 0;
    const end = new Date(session.question_started_at).getTime() + currentQuestion.time_limit * 1000;
    return Math.max(0, Math.ceil((end - now) / 1000));
  }, [session, currentQuestion, now]);

  useEffect(() => {
    if (session?.status === "question" && timeLeft === 0 && currentQuestion) {
      // Auto reveal
      void revealAnswers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, session?.status]);

  const startGame = async () => {
    if (!players.length) { toast.error("Need at least one player"); return; }
    await advanceToQuestion(0);
  };

  const advanceToQuestion = async (idx: number) => {
    await supabase.from("game_sessions").update({
      status: "question",
      current_question_index: idx,
      question_started_at: new Date().toISOString(),
    }).eq("id", sessionId);
  };

  const revealAnswers = async () => {
    if (!currentQuestion) return;
    // Score players
    const { data: pas } = await supabase
      .from("player_answers")
      .select("player_id, points_awarded")
      .eq("question_id", currentQuestion.id);
    const totals = new Map<string, number>();
    for (const pa of pas ?? []) {
      totals.set(pa.player_id, (totals.get(pa.player_id) ?? 0) + (pa.points_awarded ?? 0));
    }
    // Update player scores by adding awarded points (already computed at submit time)
    // We just need to recompute totals = sum(points_awarded for player), set as score.
    const { data: allAnswers } = await supabase
      .from("player_answers")
      .select("player_id, points_awarded")
      .in("player_id", players.map((p) => p.id).length ? players.map((p) => p.id) : [""]);
    const scoreMap = new Map<string, number>();
    for (const pa of allAnswers ?? []) {
      scoreMap.set(pa.player_id, (scoreMap.get(pa.player_id) ?? 0) + (pa.points_awarded ?? 0));
    }
    await Promise.all(
      players.map((p) =>
        supabase.from("players").update({ score: scoreMap.get(p.id) ?? 0 }).eq("id", p.id),
      ),
    );
    await supabase.from("game_sessions").update({ status: "reveal" }).eq("id", sessionId);
  };

  const next = async () => {
    if (!session) return;
    const nextIdx = session.current_question_index + 1;
    if (nextIdx >= questions.length) {
      await supabase.from("game_sessions").update({ status: "finished" }).eq("id", sessionId);
    } else {
      await advanceToQuestion(nextIdx);
    }
  };

  if (!session) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><div className="text-muted-foreground">Loading…</div></div>;
  }

  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="min-h-screen bg-background bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo size="sm" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" /> {players.length}
          <Button asChild variant="ghost" size="sm" className="ml-2"><Link to="/dashboard">End</Link></Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        {session.status === "lobby" && (
          <Lobby pin={session.pin} players={sortedPlayers} onStart={startGame} canStart={questions.length > 0} />
        )}

        {(session.status === "question" || session.status === "reveal") && currentQuestion && (
          <HostQuestion
            q={currentQuestion}
            idx={session.current_question_index}
            total={questions.length}
            timeLeft={timeLeft}
            answers={answersCount}
            playersCount={players.length}
            status={session.status}
            onSkip={revealAnswers}
            onNext={next}
            sortedPlayers={sortedPlayers}
          />
        )}

        {session.status === "finished" && (
          <FinalLeaderboard players={sortedPlayers} />
        )}
      </main>
    </div>
  );
}

function Lobby({ pin, players, onStart, canStart }: { pin: string; players: PlayerRow[]; onStart: () => void; canStart: boolean }) {
  const joinUrl = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="rounded-3xl border border-border bg-card p-6 text-center shadow-card sm:p-8">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Go to {joinUrl.replace(/^https?:\/\//, "")}</p>
        <p className="mt-4 text-sm uppercase tracking-wider text-muted-foreground">Game PIN</p>
        <div className="mt-2 font-display text-7xl font-extrabold tracking-[0.15em] text-primary sm:text-8xl">
          {pin}
        </div>
        <Button onClick={onStart} disabled={!canStart || !players.length} size="lg" className="mt-8 w-full bg-gradient-mint text-primary-foreground shadow-glow">
          <Play className="mr-2 h-5 w-5" /> Start game
        </Button>
        {!players.length && <p className="mt-3 text-xs text-muted-foreground">Waiting for players to join…</p>}
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Players</h2>
          <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">{players.length}</span>
        </div>
        {players.length === 0 ? (
          <div className="mt-10 flex flex-col items-center text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-40" />
            <p className="mt-3 text-sm">No one's here yet. Share the PIN!</p>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            {players.map((p) => (
              <div key={p.id} className="rounded-xl bg-secondary px-3 py-2 font-semibold animate-slide-up">
                {p.nickname}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HostQuestion({
  q, idx, total, timeLeft, answers, playersCount, status, onSkip, onNext, sortedPlayers,
}: {
  q: QuestionWithAnswers;
  idx: number;
  total: number;
  timeLeft: number;
  answers: number;
  playersCount: number;
  status: SessionStatus;
  onSkip: () => void;
  onNext: () => void;
  sortedPlayers: PlayerRow[];
}) {
  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wider text-primary">Question {idx + 1} / {total}</span>
        {status === "question" ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold">
              {answers} / {playersCount} answered
            </span>
            <Button variant="outline" size="sm" onClick={onSkip}><SkipForward className="mr-1 h-4 w-4" /> Skip</Button>
          </div>
        ) : (
          <Button onClick={onNext} className="bg-gradient-mint text-primary-foreground">
            Next <SkipForward className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 text-center shadow-card sm:p-10">
        <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-5xl">{q.question_text}</h1>
        {q.image_url && (
          <div className="mt-6 flex justify-center">
            <img src={q.image_url} alt="" className="max-h-72 rounded-2xl object-contain" />
          </div>
        )}
        {status === "question" && (
          <div className="mt-8 inline-flex h-24 w-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
            <span className="font-display text-5xl font-extrabold">{timeLeft}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {q.answers.map((a) => {
          const showCorrect = status === "reveal";
          const dim = showCorrect && !a.is_correct;
          return (
            <div
              key={a.id}
              className={`relative flex items-center gap-4 rounded-2xl p-5 text-white shadow-card transition ${ANSWER_BG[a.color_index % 4]} ${dim ? "opacity-40" : ""}`}
            >
              <span className="font-display text-2xl">{ANSWER_SHAPES[a.color_index % 4]}</span>
              <span className="flex-1 font-display text-lg font-bold">{a.answer_text}</span>
              {showCorrect && a.is_correct && (
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase">Correct</span>
              )}
            </div>
          );
        })}
      </div>

      {status === "reveal" && (
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Trophy className="h-5 w-5 text-primary" /> Leaderboard</h2>
          <div className="mt-4 space-y-2">
            {sortedPlayers.slice(0, 8).map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-secondary p-3">
                <span className="font-display text-lg font-bold w-6">{i + 1}</span>
                <span className="flex-1 font-semibold">{p.nickname}</span>
                <span className="font-display font-bold text-primary">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FinalLeaderboard({ players }: { players: PlayerRow[] }) {
  const podium = players.slice(0, 3);
  const rest = players.slice(3);
  return (
    <div className="space-y-8 animate-slide-up">
      <div className="text-center">
        <Trophy className="mx-auto h-14 w-14 text-primary" />
        <h1 className="mt-4 font-display text-5xl font-extrabold">Final results</h1>
      </div>

      {podium.length > 0 && (
        <div className="grid grid-cols-3 items-end gap-4">
          {[1, 0, 2].map((i) => {
            const p = podium[i];
            if (!p) return <div key={i} />;
            const heights = ["h-32", "h-44", "h-24"];
            const colors = ["bg-answer-2", "bg-gradient-mint", "bg-answer-3"];
            return (
              <div key={p.id} className="flex flex-col items-center">
                <div className="font-display text-lg font-bold">{p.nickname}</div>
                <div className="text-sm text-primary">{p.score}</div>
                <div className={`mt-2 w-full rounded-t-2xl ${heights[i]} ${colors[i]} flex items-start justify-center pt-3 text-3xl font-display font-extrabold text-primary-foreground`}>
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="space-y-2">
            {rest.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-secondary p-3">
                <span className="w-6 font-display font-bold">{i + 4}</span>
                <span className="flex-1 font-semibold">{p.nickname}</span>
                <span className="font-display font-bold text-primary">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-center">
        <Button asChild size="lg" variant="outline"><Link to="/dashboard">Back to dashboard</Link></Button>
      </div>
    </div>
  );
}

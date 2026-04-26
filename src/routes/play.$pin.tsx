import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ANSWER_BG, ANSWER_SHAPES, computePoints, loadPlayerId, savePlayerId, type QuestionWithAnswers, type SessionStatus,
} from "@/lib/game";
import { Trophy, Check, X } from "lucide-react";

export const Route = createFileRoute("/play/$pin")({
  component: PlayerView,
});

interface SessionRow {
  id: string;
  pin: string;
  quiz_id: string;
  status: SessionStatus;
  current_question_index: number;
  question_started_at: string | null;
}

function PlayerView() {
  const { pin } = Route.useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionRow | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [questions, setQuestions] = useState<QuestionWithAnswers[]>([]);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ correct: boolean; points: number } | null>(null);
  const [score, setScore] = useState(0);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<number | null>(null);

  // load session by PIN
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("game_sessions").select("*").eq("pin", pin).maybeSingle();
      if (error || !data) { toast.error("Game not found"); navigate({ to: "/" }); return; }
      setSession(data as SessionRow);
      const existing = loadPlayerId(data.id);
      if (existing) {
        const { data: p } = await supabase.from("players").select("id, nickname, score").eq("id", existing).maybeSingle();
        if (p) {
          setPlayerId(p.id);
          setNickname(p.nickname);
          setScore(p.score);
        }
      }
      const { data: qs } = await supabase
        .from("questions").select("*, answers(*)").eq("quiz_id", data.quiz_id).order("order_index");
      setQuestions(((qs ?? []) as unknown as QuestionWithAnswers[]).map((q) => ({
        ...q, answers: [...q.answers].sort((a, b) => a.order_index - b.order_index),
      })));
    })();
  }, [pin, navigate]);

  // realtime: session updates
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`play-${session.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${session.id}` }, (p) => {
        setSession(p.new as SessionRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.id]);

  // realtime: own score updates
  useEffect(() => {
    if (!playerId) return;
    const ch = supabase
      .channel(`player-${playerId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${playerId}` }, (p) => {
        const np = p.new as { score: number };
        setScore(np.score);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [playerId]);

  const currentQuestion = useMemo(
    () => session && session.status !== "lobby" ? questions[session.current_question_index] : null,
    [session, questions],
  );

  // Reset selection when question changes
  useEffect(() => {
    if (session?.status === "question") {
      setSelectedAnswerId(null);
      setLastResult(null);
    }
  }, [session?.status, session?.current_question_index]);

  // Compute last result on reveal
  useEffect(() => {
    if (session?.status !== "reveal" || !currentQuestion || !playerId) return;
    (async () => {
      const { data } = await supabase
        .from("player_answers")
        .select("answer_id, points_awarded")
        .eq("player_id", playerId)
        .eq("question_id", currentQuestion.id)
        .maybeSingle();
      if (!data) {
        setLastResult({ correct: false, points: 0 });
        return;
      }
      const ans = currentQuestion.answers.find((a) => a.id === data.answer_id);
      setLastResult({ correct: !!ans?.is_correct, points: data.points_awarded });
    })();
  }, [session?.status, currentQuestion, playerId]);

  // Ticker
  useEffect(() => {
    if (session?.status !== "question") return;
    tickRef.current = window.setInterval(() => setNow(Date.now()), 250);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [session?.status]);

  const timeLeft = useMemo(() => {
    if (!session?.question_started_at || !currentQuestion) return 0;
    const end = new Date(session.question_started_at).getTime() + currentQuestion.time_limit * 1000;
    return Math.max(0, Math.ceil((end - now) / 1000));
  }, [session, currentQuestion, now]);

  const join = async () => {
    if (!session) return;
    const name = joinName.trim().slice(0, 20);
    if (name.length < 2) { toast.error("Pick a longer nickname"); return; }
    setJoining(true);
    const { data, error } = await supabase
      .from("players")
      .insert({ session_id: session.id, nickname: name })
      .select("id, nickname, score")
      .single();
    setJoining(false);
    if (error || !data) {
      toast.error(error?.code === "23505" ? "Nickname taken — try another" : (error?.message ?? "Could not join"));
      return;
    }
    savePlayerId(session.id, data.id);
    setPlayerId(data.id);
    setNickname(data.nickname);
    setScore(0);
  };

  const submitAnswer = async (answerId: string) => {
    if (!session || !currentQuestion || !playerId || submittedFor === currentQuestion.id) return;
    setSelectedAnswerId(answerId);
    setSubmittedFor(currentQuestion.id);
    const responseMs = session.question_started_at
      ? Date.now() - new Date(session.question_started_at).getTime()
      : 0;
    const ans = currentQuestion.answers.find((a) => a.id === answerId);
    const points = currentQuestion.is_poll
      ? 0
      : ans?.is_correct
        ? computePoints(currentQuestion.points, responseMs, currentQuestion.time_limit)
        : 0;
    const { error } = await supabase.from("player_answers").insert({
      player_id: playerId,
      question_id: currentQuestion.id,
      answer_id: answerId,
      response_time_ms: responseMs,
      points_awarded: points,
    });
    if (error) {
      // already submitted etc
      setSubmittedFor(null);
    }
  };

  if (!session) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><div className="text-muted-foreground">Loading…</div></div>;
  }

  // Join screen
  if (!playerId) {
    return (
      <div className="flex min-h-screen flex-col bg-background bg-gradient-hero">
        <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-5"><Logo size="sm" /></header>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-12">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8 animate-slide-up">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Game PIN</p>
            <p className="font-display text-4xl font-extrabold tracking-[0.15em] text-primary">{session.pin}</p>
            <h1 className="mt-6 font-display text-2xl font-bold">Pick a nickname</h1>
            <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); join(); }}>
              <Input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="Your nickname"
                maxLength={20}
                className="h-14 text-center text-xl"
                autoFocus
              />
              <Button type="submit" size="lg" className="w-full bg-gradient-mint text-primary-foreground" disabled={joining || session.status !== "lobby"}>
                {session.status !== "lobby" ? "Game already started" : joining ? "Joining…" : "Join game"}
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Lobby (joined)
  if (session.status === "lobby") {
    return (
      <CenteredCard nickname={nickname} score={score} title="You're in!" subtitle="Waiting for the host to start the game…">
        <div className="mt-6 inline-flex h-3 w-24 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-full origin-left animate-pulse-glow bg-primary" />
        </div>
      </CenteredCard>
    );
  }

  // Question
  if (session.status === "question" && currentQuestion) {
    const submitted = submittedFor === currentQuestion.id;
    return (
      <div className="flex min-h-screen flex-col bg-background bg-gradient-hero">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <span className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold">{nickname}</span>
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-bold text-primary">{score}</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-display font-bold">{timeLeft}</span>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6">
          {submitted ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center animate-slide-up">
              <div className="font-display text-2xl font-bold">
                {currentQuestion.is_poll ? "Vote recorded!" : "Answer locked in!"}
              </div>
              <p className="mt-2 text-muted-foreground">Hang tight — waiting for everyone else.</p>
              <div className="mt-8 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
                <span className="font-display text-2xl font-bold">{timeLeft}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 text-center text-sm text-muted-foreground">
                Question {session.current_question_index + 1}
              </div>
              <h2 className="mt-2 text-center font-display text-2xl font-bold">{currentQuestion.question_text}</h2>
              <div className="mt-6 grid flex-1 grid-cols-2 gap-3 sm:grid-cols-2">
                {currentQuestion.answers.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => submitAnswer(a.id)}
                    disabled={!!selectedAnswerId}
                    className={`flex min-h-[110px] items-center justify-center gap-3 rounded-2xl p-4 text-white shadow-card transition active:scale-95 ${ANSWER_BG[a.color_index % 4]} ${selectedAnswerId && selectedAnswerId !== a.id ? "opacity-40" : ""}`}
                  >
                    <span className="font-display text-3xl">{ANSWER_SHAPES[a.color_index % 4]}</span>
                    <span className="font-display text-lg font-bold leading-tight">{a.answer_text}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  // Reveal
  if (session.status === "reveal") {
    if (currentQuestion?.is_poll) {
      return (
        <CenteredCard
          nickname={nickname}
          score={score}
          title="Thanks for voting!"
          subtitle="Check the host screen for results."
        >
          <div className="mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-answer-2 text-white">
            <Check className="h-10 w-10" />
          </div>
        </CenteredCard>
      );
    }
    const correct = lastResult?.correct;
    return (
      <CenteredCard
        nickname={nickname}
        score={score}
        title={lastResult === null ? "Checking…" : correct ? "Correct! 🎉" : "Not this time"}
        subtitle={lastResult ? (correct ? `+${lastResult.points} points` : "No points this round") : ""}
      >
        <div className={`mt-6 flex h-20 w-20 items-center justify-center rounded-full ${correct ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
          {correct ? <Check className="h-10 w-10" /> : <X className="h-10 w-10" />}
        </div>
      </CenteredCard>
    );
  }

  // Finished
  if (session.status === "finished") {
    return (
      <CenteredCard nickname={nickname} score={score} title="Game over!" subtitle="Thanks for playing.">
        <Trophy className="mt-6 h-14 w-14 text-primary" />
        <div className="mt-4 font-display text-5xl font-extrabold text-primary">{score}</div>
      </CenteredCard>
    );
  }

  return null;
}

function CenteredCard({
  nickname, score, title, subtitle, children,
}: { nickname: string; score: number; title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background bg-gradient-hero">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <span className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold">{nickname}</span>
        <span className="font-display text-lg font-bold text-primary">{score}</span>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 pb-12 text-center animate-slide-up">
        <h1 className="font-display text-3xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        {children}
      </main>
    </div>
  );
}

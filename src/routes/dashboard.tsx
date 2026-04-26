import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Play, Pencil, Copy, Trash2, ListChecks } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  questions: { count: number }[];
}

function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const refresh = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("quizzes")
      .select("id, title, description, created_at, questions(count)")
      .eq("host_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setQuizzes((data as unknown as QuizRow[]) ?? []);
  };

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const createQuiz = async () => {
    if (!user) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("quizzes")
      .insert({ host_id: user.id, title: "Untitled quiz", description: "" })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not create quiz");
      return;
    }
    navigate({ to: "/quiz/$id/edit", params: { id: data.id } });
  };

  const duplicateQuiz = async (id: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const [{ data: q }, { data: qs }] = await Promise.all([
        supabase.from("quizzes").select("title, description").eq("id", id).single(),
        supabase.from("questions").select("id, question_text, image_url, time_limit, points, order_index").eq("quiz_id", id).order("order_index"),
      ]);
      if (!q) throw new Error("Original quiz not found");
      const { data: copy, error } = await supabase
        .from("quizzes")
        .insert({ host_id: user.id, title: q.title + " (copy)", description: q.description })
        .select("id")
        .single();
      if (error || !copy) throw error ?? new Error("Copy failed");

      for (const oq of qs ?? []) {
        const { data: ans } = await supabase
          .from("answers")
          .select("answer_text, is_correct, color_index, order_index")
          .eq("question_id", oq.id);
        const { data: newQ, error: qErr } = await supabase
          .from("questions")
          .insert({
            quiz_id: copy.id,
            question_text: oq.question_text,
            image_url: oq.image_url,
            time_limit: oq.time_limit,
            points: oq.points,
            order_index: oq.order_index,
          })
          .select("id")
          .single();
        if (qErr || !newQ) continue;
        if (ans?.length) {
          await supabase.from("answers").insert(ans.map((a) => ({ ...a, question_id: newQ.id })));
        }
      }
      toast.success("Quiz duplicated");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("quizzes").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else toast.success("Quiz deleted");
    setDeleteId(null);
    refresh();
  };

  const startGame = async (quizId: string) => {
    if (!user) return;
    const { count } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId);
    if (!count) {
      toast.error("Add at least one question first");
      return;
    }
    const { data, error } = await supabase
      .from("game_sessions")
      .insert({ quiz_id: quizId, host_id: user.id, pin: "" })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Could not start session");
      return;
    }
    navigate({ to: "/host/$sessionId", params: { sessionId: data.id } });
  };

  return (
    <div className="min-h-screen bg-background bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Home</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 py-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Your quizzes</h1>
            <p className="mt-1 text-sm text-muted-foreground">Build, duplicate and host live games.</p>
          </div>
          <Button onClick={createQuiz} disabled={busy} size="lg" className="bg-gradient-mint text-primary-foreground">
            <Plus className="mr-2 h-4 w-4" /> New quiz
          </Button>
        </div>

        {quizzes === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card/50" />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-border bg-card/40 p-12 text-center">
            <ListChecks className="h-12 w-12 text-primary" />
            <h2 className="mt-4 font-display text-xl font-bold">No quizzes yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create your first quiz to start hosting live games. Add questions, set timers, and pick correct answers.
            </p>
            <Button onClick={createQuiz} className="mt-6 bg-gradient-mint text-primary-foreground" size="lg">
              <Plus className="mr-2 h-4 w-4" /> Create your first quiz
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((q) => {
              const qCount = q.questions?.[0]?.count ?? 0;
              return (
                <div key={q.id} className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/50">
                  <div className="flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {qCount} question{qCount === 1 ? "" : "s"}
                    </div>
                    <h3 className="mt-2 line-clamp-2 font-display text-xl font-bold">{q.title}</h3>
                    {q.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{q.description}</p>
                    )}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button size="sm" className="flex-1 bg-gradient-mint text-primary-foreground" onClick={() => startGame(q.id)}>
                      <Play className="mr-1 h-4 w-4" /> Host
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/quiz/$id/edit" params={{ id: q.id }}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => duplicateQuiz(q.id)} disabled={busy}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeleteId(q.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the quiz and all its questions. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

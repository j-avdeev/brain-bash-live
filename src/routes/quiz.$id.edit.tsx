import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, ChevronUp, ChevronDown, Check, ImagePlus, X, Play, BarChart3 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/quiz/$id/edit")({
  component: QuizEditor,
});

interface AnswerDraft {
  id?: string;
  answer_text: string;
  is_correct: boolean;
  color_index: number;
  order_index: number;
  _isNew?: boolean;
}
interface QuestionDraft {
  id?: string;
  question_text: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  order_index: number;
  is_poll: boolean;
  answers: AnswerDraft[];
  _isNew?: boolean;
  _dirty?: boolean;
}

const ANSWER_COLORS = ["bg-answer-1", "bg-answer-2", "bg-answer-3", "bg-answer-4"];

function emptyAnswers(): AnswerDraft[] {
  return [0, 1, 2, 3].map((i) => ({
    answer_text: "",
    is_correct: false,
    color_index: i,
    order_index: i,
    _isNew: true,
  }));
}

function emptyQuestion(order: number): QuestionDraft {
  return {
    question_text: "",
    image_url: null,
    time_limit: 20,
    points: 1000,
    order_index: order,
    is_poll: false,
    answers: emptyAnswers(),
    _isNew: true,
    _dirty: true,
  };
}

function QuizEditor() {
  const { id } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: quiz, error } = await supabase
        .from("quizzes").select("title, description, host_id").eq("id", id).single();
      if (error || !quiz) { toast.error("Quiz not found"); navigate({ to: "/dashboard" }); return; }
      if (quiz.host_id !== user.id) { toast.error("Not your quiz"); navigate({ to: "/dashboard" }); return; }
      setTitle(quiz.title);
      setDescription(quiz.description ?? "");
      const { data: qs } = await supabase
        .from("questions").select("*, answers(*)").eq("quiz_id", id).order("order_index");
      const drafts: QuestionDraft[] = (qs ?? []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        image_url: q.image_url,
        time_limit: q.time_limit,
        points: q.points,
        order_index: q.order_index,
        answers: (q.answers as AnswerDraft[])
          .sort((a, b) => a.order_index - b.order_index)
          .map((a) => ({ ...a })),
      }));
      setQuestions(drafts.length ? drafts : [emptyQuestion(0)]);
      setLoaded(true);
    })();
  }, [id, user, navigate]);

  const updateMeta = async () => {
    await supabase.from("quizzes").update({
      title: title.trim() || "Untitled quiz",
      description,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  };

  const saveQuestion = async (q: QuestionDraft, idx: number): Promise<QuestionDraft | null> => {
    if (!q.question_text.trim()) {
      toast.error(`Question ${idx + 1} needs text`);
      return null;
    }
    const validAnswers = q.answers.filter((a) => a.answer_text.trim());
    if (validAnswers.length < 2) {
      toast.error(`Question ${idx + 1} needs at least 2 answers`);
      return null;
    }
    if (!validAnswers.some((a) => a.is_correct)) {
      toast.error(`Question ${idx + 1} needs at least one correct answer`);
      return null;
    }

    let questionId = q.id;
    if (!questionId) {
      const { data, error } = await supabase.from("questions").insert({
        quiz_id: id,
        question_text: q.question_text,
        image_url: q.image_url,
        time_limit: q.time_limit,
        points: q.points,
        order_index: idx,
      }).select("id").single();
      if (error || !data) { toast.error(error?.message ?? "Save failed"); return null; }
      questionId = data.id;
    } else {
      await supabase.from("questions").update({
        question_text: q.question_text,
        image_url: q.image_url,
        time_limit: q.time_limit,
        points: q.points,
        order_index: idx,
      }).eq("id", questionId);
    }

    // Replace all answers (simpler than diffing)
    await supabase.from("answers").delete().eq("question_id", questionId);
    if (validAnswers.length) {
      await supabase.from("answers").insert(
        validAnswers.map((a, i) => ({
          question_id: questionId!,
          answer_text: a.answer_text,
          is_correct: a.is_correct,
          color_index: a.color_index,
          order_index: i,
        })),
      );
    }
    return { ...q, id: questionId, _isNew: false, _dirty: false };
  };

  const saveAll = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await updateMeta();
      const updated: QuestionDraft[] = [];
      for (let i = 0; i < questions.length; i++) {
        const saved = await saveQuestion(questions[i], i);
        if (!saved) { setSaving(false); return false; }
        updated.push(saved);
      }
      setQuestions(updated);
      toast.success("Saved");
      return true;
    } finally {
      setSaving(false);
    }
  };

  const handleHost = async () => {
    const ok = await saveAll();
    if (!ok || !user) return;
    const { data, error } = await supabase
      .from("game_sessions")
      .insert({ quiz_id: id, host_id: user.id, pin: "" })
      .select("id").single();
    if (error || !data) { toast.error(error?.message ?? "Could not start"); return; }
    navigate({ to: "/host/$sessionId", params: { sessionId: data.id } });
  };

  const addQuestion = () => {
    setQuestions((qs) => {
      const next = [...qs, emptyQuestion(qs.length)];
      setActiveIdx(next.length - 1);
      return next;
    });
  };

  const removeQuestion = async (idx: number) => {
    const q = questions[idx];
    if (q.id) await supabase.from("questions").delete().eq("id", q.id);
    setQuestions((qs) => {
      const next = qs.filter((_, i) => i !== idx);
      return next.length ? next : [emptyQuestion(0)];
    });
    setActiveIdx((i) => Math.max(0, Math.min(i, questions.length - 2)));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= questions.length) return;
    setQuestions((qs) => {
      const copy = [...qs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
    setActiveIdx(j);
  };

  const updateActive = (patch: Partial<QuestionDraft>) => {
    setQuestions((qs) => qs.map((q, i) => (i === activeIdx ? { ...q, ...patch, _dirty: true } : q)));
  };
  const updateAnswer = (ai: number, patch: Partial<AnswerDraft>) => {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i !== activeIdx ? q : { ...q, _dirty: true, answers: q.answers.map((a, j) => (j === ai ? { ...a, ...patch } : a)) },
      ),
    );
  };
  const addAnswer = () => {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== activeIdx || q.answers.length >= 4) return q;
      return { ...q, _dirty: true, answers: [...q.answers, { answer_text: "", is_correct: false, color_index: q.answers.length, order_index: q.answers.length }] };
    }));
  };
  const removeAnswer = (ai: number) => {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== activeIdx || q.answers.length <= 2) return q;
      return { ...q, _dirty: true, answers: q.answers.filter((_, j) => j !== ai) };
    }));
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const active = questions[activeIdx];

  return (
    <div className="min-h-screen bg-background bg-gradient-hero">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="hidden text-sm text-muted-foreground sm:inline">/ Edit quiz</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/dashboard">Back</Link></Button>
            <Button variant="outline" size="sm" onClick={saveAll} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" className="bg-gradient-mint text-primary-foreground" onClick={handleHost}>
              <Play className="mr-1 h-4 w-4" /> Host
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quiz title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 font-display text-lg font-bold" placeholder="Untitled quiz" />
            <Label className="mt-3 block text-xs uppercase tracking-wider text-muted-foreground">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 min-h-[60px]" placeholder="Optional" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">Questions</h2>
              <Button size="sm" variant="ghost" onClick={addQuestion}><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-1">
              {questions.map((q, i) => (
                <button
                  key={q.id ?? `new-${i}`}
                  onClick={() => setActiveIdx(i)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    i === activeIdx ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary"
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary font-display text-xs font-bold">{i + 1}</span>
                  <span className="flex-1 truncate">{q.question_text || "Untitled question"}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Editor */}
        <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Question {activeIdx + 1}</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => moveQuestion(activeIdx, -1)} disabled={activeIdx === 0}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => moveQuestion(activeIdx, 1)} disabled={activeIdx === questions.length - 1}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => removeQuestion(activeIdx)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <Label htmlFor="qtext">Question</Label>
              <Textarea
                id="qtext"
                value={active.question_text}
                onChange={(e) => updateActive({ question_text: e.target.value })}
                placeholder="What's the answer?"
                className="mt-2 min-h-[80px] text-lg"
                maxLength={300}
              />
            </div>

            <div>
              <Label>Image URL (optional)</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  value={active.image_url ?? ""}
                  onChange={(e) => updateActive({ image_url: e.target.value || null })}
                  placeholder="https://…"
                />
                {active.image_url && (
                  <Button variant="outline" size="icon" onClick={() => updateActive({ image_url: null })}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {active.image_url && (
                <div className="mt-3 flex items-center justify-center overflow-hidden rounded-xl border border-border bg-background/50">
                  <img src={active.image_url} alt="" className="max-h-56 object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                </div>
              )}
              {!active.image_url && (
                <div className="mt-3 flex h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  <ImagePlus className="h-4 w-4" /> Paste an image URL above
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="time">Time limit (seconds)</Label>
                <Input id="time" type="number" min={5} max={120} value={active.time_limit}
                  onChange={(e) => updateActive({ time_limit: Math.max(5, Math.min(120, Number(e.target.value) || 20)) })} />
              </div>
              <div>
                <Label htmlFor="pts">Points</Label>
                <Input id="pts" type="number" min={0} max={5000} step={100} value={active.points}
                  onChange={(e) => updateActive({ points: Math.max(0, Math.min(5000, Number(e.target.value) || 1000)) })} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Answers (tap check to mark correct)</Label>
                {active.answers.length < 4 && (
                  <Button size="sm" variant="ghost" onClick={addAnswer}><Plus className="mr-1 h-3 w-3" /> Add</Button>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {active.answers.map((a, ai) => (
                  <div key={ai} className={`relative rounded-2xl p-1 ${ANSWER_COLORS[a.color_index % 4]}`}>
                    <div className="flex items-center gap-2 rounded-xl bg-card/95 p-2">
                      <button
                        onClick={() => updateAnswer(ai, { is_correct: !a.is_correct })}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 transition ${
                          a.is_correct ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                        }`}
                        aria-label={a.is_correct ? "Correct" : "Mark correct"}
                      >
                        {a.is_correct && <Check className="h-5 w-5" />}
                      </button>
                      <Input
                        value={a.answer_text}
                        onChange={(e) => updateAnswer(ai, { answer_text: e.target.value })}
                        placeholder={`Answer ${ai + 1}`}
                        className="border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
                        maxLength={120}
                      />
                      {active.answers.length > 2 && (
                        <Button size="icon" variant="ghost" onClick={() => removeAnswer(ai)} className="h-8 w-8">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [joining, setJoining] = useState(false);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = pin.replace(/\D/g, "");
    if (cleaned.length < 4) {
      toast.error("Enter a valid game PIN");
      return;
    }
    setJoining(true);
    const { data, error } = await supabase
      .from("game_sessions")
      .select("id, pin, status")
      .eq("pin", cleaned)
      .maybeSingle();
    setJoining(false);
    if (error || !data) {
      toast.error("Game not found. Check the PIN.");
      return;
    }
    navigate({ to: "/play/$pin", params: { pin: cleaned } });
  };

  return (
    <div className="min-h-screen bg-background bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link to="/auth">Host sign in</Link>
            </Button>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <section className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col justify-center animate-slide-up">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Live multiplayer
            </span>
            <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Make any room <span className="bg-gradient-mint bg-clip-text text-transparent">light up.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Build colorful quizzes, share a PIN, and watch everyone play in real time — on any device, no app needed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-gradient-mint text-primary-foreground shadow-glow hover:opacity-95">
                <Link to={user ? "/dashboard" : "/auth"}>Create a quiz →</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#join">I have a PIN</a>
              </Button>
            </div>
            <div className="mt-10 flex gap-8 text-sm text-muted-foreground">
              <div>
                <div className="font-display text-2xl font-bold text-foreground">∞</div>
                <div>Players per game</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold text-foreground">&lt;1s</div>
                <div>Real-time sync</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold text-foreground">0</div>
                <div>Player signup</div>
              </div>
            </div>
          </div>

          <div id="join" className="flex flex-col justify-center">
            <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
              <h2 className="font-display text-2xl font-bold">Join a game</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the PIN shown on the host's screen.
              </p>
              <form onSubmit={handleJoin} className="mt-6 space-y-4">
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Game PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-16 rounded-2xl text-center font-display text-3xl tracking-[0.4em]"
                />
                <Button type="submit" size="lg" className="w-full bg-gradient-mint text-primary-foreground" disabled={joining}>
                  {joining ? "Joining…" : "Join game"}
                </Button>
              </form>
              <div className="mt-6 grid grid-cols-2 gap-3 text-center text-xs text-muted-foreground">
                <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                  <div className="font-display text-lg font-bold text-foreground">1.</div>
                  Get PIN from host
                </div>
                <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                  <div className="font-display text-lg font-bold text-foreground">2.</div>
                  Pick a nickname
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-24 grid gap-5 sm:grid-cols-3">
          {[
            { t: "Build fast", d: "Drag-and-drop quiz builder with images, timers and points." },
            { t: "Play anywhere", d: "Mobile-friendly. Players join in their browser with no install." },
            { t: "Live leaderboard", d: "Real-time scoring keeps the energy up between every round." },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-border bg-card p-6">
              <h3 className="font-display text-lg font-bold">{f.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border/50 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} QuizPop. Made for live classrooms & game nights.
      </footer>
    </div>
  );
}

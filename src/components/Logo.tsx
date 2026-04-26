import { Link } from "@tanstack/react-router";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  };
  return (
    <Link to="/" className={`font-display font-extrabold tracking-tight ${sizes[size]} inline-flex items-center gap-2`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-mint text-primary-foreground shadow-glow">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path d="M5 4l14 8-14 8V4z" fill="currentColor" />
        </svg>
      </span>
      <span>
        Quiz<span className="text-primary">Pop</span>
      </span>
    </Link>
  );
}

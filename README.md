# QuizPop

QuizPop is a live, browser-based quiz game for classrooms, teams, and game nights. Hosts create quizzes, start a live session, and share a game PIN. Players join from any device without creating an account, answer in real time, and see scores update on the live leaderboard.

## Features

- Host accounts with Supabase authentication.
- Quiz dashboard for creating and editing quizzes.
- Live lobby with a shareable game PIN.
- Player join flow with no signup required.
- Timed questions, polls, answer reveal, scoring, and final results.
- Realtime game state powered by Supabase.

## Tech Stack

- React 19
- TanStack Router / TanStack Start
- Vite
- Tailwind CSS
- Supabase
- shadcn/ui-style components

## Local Development

Install dependencies:

```sh
npm install
```

Create a local `.env` file with your Supabase project values:

```sh
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Start the dev server:

```sh
npm run dev
```

Build for production:

```sh
npm run build
```

## GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`. On pushes to `main`, it builds a static TanStack Start shell, creates a `404.html` fallback for client-side routes, and publishes `dist/client` to GitHub Pages.

Before the workflow can deploy successfully, add these repository secrets in GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Then open the repository settings on GitHub and set Pages to deploy from GitHub Actions. The site will be served at:

```text
https://<your-github-user-or-org>.github.io/quizpop/
```

For a local static Pages build, run:

```sh
npm run build:pages
```

If you deploy with a custom domain, set `GITHUB_PAGES_BASE_PATH=/` in the workflow build environment so Vite emits root-relative asset URLs.

// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const normalizeBasePath = (basePath: string) => {
  if (basePath === "/") return "/";
  return `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
};

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").pop() ?? "quizpop";
const isGitHubPagesBuild =
  process.env.GITHUB_PAGES === "true" || process.env.npm_lifecycle_event === "build:pages";
const githubPagesBase = normalizeBasePath(process.env.GITHUB_PAGES_BASE_PATH ?? repositoryName);

export default defineConfig({
  vite: {
    base: isGitHubPagesBuild ? githubPagesBase : "/",
  },
  tanstackStart: isGitHubPagesBuild
    ? {
        spa: {
          enabled: true,
          prerender: {
            outputPath: "/index",
          },
        },
      }
    : {},
});

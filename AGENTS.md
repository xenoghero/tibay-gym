# Coding workflow

Always read and apply the `ponytail` skill before any coding task, including writing, fixing, refactoring, reviewing code, or choosing dependencies. Use its default `full` level unless the user specifies another level or explicitly disables it.

# Commits

Commit as the repository's configured git user (Adrian Luna <reinieradrianluna@gmail.com>) so every commit counts toward the owner's GitHub profile. Do not add `Co-Authored-By` or any other AI attribution trailer to commit messages or PR descriptions, and do not override the author or committer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

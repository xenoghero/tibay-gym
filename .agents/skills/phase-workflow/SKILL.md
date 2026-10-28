---
name: phase-workflow
description: Implement one phase at a time from a project's default TASKLIST.md or an explicitly named task list, logging everything built/changed/fixed into a per-phase markdown file, then updating the selected task list — and stopping until the next phase is explicitly requested. Use when the user says "do phase X", "work on phase X", "continue phase X", or references a project task list / build phases.
---

# Phase Workflow

A disciplined, one-phase-at-a-time development loop built around a project's task list. It keeps three things in sync: the code, a running log of what happened in each phase, and the task list's checkboxes — so the user always has a clear, written record of exactly what's been built and where the project stands.

This skill is project-agnostic. It looks for the task list and progress folder relative to whatever project the user is working in.

## Locating the project files

1. Select the task list for the current request:
   - If the user does not name a task list, use the original default: `Documentation/Plan/TASKLIST.md`, even when other task lists exist.
   - If the user explicitly names a task list, use that file. Resolve a supplied path relative to the project root; otherwise look for the named file in `Documentation/Plan/`. A name without an extension means the corresponding `.md` file.
   - If the selected file is missing or the supplied name matches multiple files, ask the user to identify it. An explicit custom name must not silently fall back to the default task list.
2. Select the progress folder based on the resolved task list:
   - For the default `Documentation/Plan/TASKLIST.md`, retain `Documentation/Progress/`.
   - For any explicitly selected non-default task list, use `Documentation/Progress/<task-list-name>/`, where `<task-list-name>` is the selected file's basename without its extension, preserving its spelling. For example, `Documentation/Plan/ADMIN-TASKLIST.md` uses `Documentation/Progress/ADMIN-TASKLIST/`.
   - Create the selected progress folder if missing when first writing a phase log; reuse it for subsequent work on that task list.
3. Read the selected task list in full before implementing anything — phase numbers, phase titles, and every checkbox item under the requested phase. Also skim any companion docs the task list references (content/layout specs, project plan) for the requested phase's items, since those hold the actual detail the checklist items are shorthand for.

Throughout this workflow, **selected task list** and **selected progress folder** refer to the paths resolved above. All phase lookup, checklist updates, progress-table entries, and phase logs use that pair.

## Core loop — when the user names a phase

**Trigger phrasing to recognize:** "do phase N", "work on phase N", "let's build phase N", "continue phase N", "start Overview tab" (matching a phase's title), etc. If it's ambiguous which phase they mean, ask before proceeding.

### 1. Scope check
State back, briefly, the selected task list, which phase and which checklist items you're about to work on, pulled straight from that task list. If some items in that phase depend on something not yet done in an earlier phase, say so before proceeding rather than silently skipping or improvising.

### 2. Implement
Do the actual work for that phase only — the code, the config, whatever the checklist items call for. Reference the design/content docs in `Documentation/Plan/` for specifics (copy, field lists, layout rules, data model) rather than inventing details. Do not touch, scaffold, or "get a head start on" any later phase, even if it looks convenient — if you notice a later-phase dependency is missing, mention it and stop rather than building it now.

### 3. Log it — per-phase markdown file
Each phase has exactly one file in the selected progress folder: `phase-<NN>-<slug>.md` (e.g. `phase-02-admin-product-management.md`), matching the phase's number and title in the selected task list. Default logs remain directly under `Documentation/Progress/`; custom task-list logs go in their named subfolder, keeping their phase histories separate.

- **If the file doesn't exist yet**, create it with this structure:

  ```markdown
  # Phase <NN> — <Phase Title>

  **Status:** in progress
  **Task list:** <selected task list path>
  **Task list items covered:** (mirror the checklist for this phase from the selected task list, as checkboxes)

  - [ ] item one
  - [ ] item two
  ...

  ---

  ## Log

  ### YYYY-MM-DD
  - What was built/changed/fixed, in plain language
  - Notable decisions made and why
  - Files touched (short list, not a full diff)

  **Suggested commit message:** `type(scope): summary`
  ```

- **If the file already exists** (returning to a phase for updates, fixes, or continued work), don't overwrite it — append a new dated `### YYYY-MM-DD` entry under `## Log` with what changed this session, and tick/untick checkboxes in the mirrored list at the top to reflect current reality.
- Every work session on a phase gets its own dated log entry, even same-day repeat sessions can share a date heading with multiple bullets — the point is a readable history, not a commit-by-commit trace.
- Each dated log entry also gets a **Suggested commit message** line: a one-liner in Conventional Commits style (`type(scope): summary`, e.g. `feat(phase-02): add admin product management CRUD`) summarizing that session's work. Pick `type` from the usual set (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, etc.) based on what was actually done, and use the phase's slug (e.g. `phase-02`) as the scope unless the work clearly maps to a narrower scope. This is a suggestion only — the skill does not run `git commit` or stage files itself; the user commits it themselves if they want it.
- When every item in the phase's checklist is done, change the file's **Status** line to `complete`.

### 4. Update the selected task list
- Check off (`[x]`) every completed item under that phase in the selected task list itself.
- Leave unfinished items unchecked if only part of the phase was done this session.
- Append a row to the **Progress Log** table at the bottom of the selected task list: date, phase, and a one-line note (not a full recap — the phase's own markdown file holds the detail).

### 5. Stop
Report a short summary of what was completed and logged, including the suggested commit message from this session's log entry. **Do not start the next phase**, even if the current one is fully checked off and the next one seems obvious. Naming the next phase in your summary is fine ("Phase 3 — Storefront: Browsing is next whenever you're ready") but do not begin it. Wait for the user to explicitly name the next phase.

## Handling fixes/updates outside the "next phase" flow

If the user reports a bug or asks for a change to something built in an already-completed phase, resolve the task list and progress folder using the same selection rules above. Implement the fix, append a dated log entry (with its own **Suggested commit message**, typically `fix(scope): summary`) to that phase's existing markdown file in the selected progress folder describing what was fixed and why, and update the selected task list only if it changes which items are done (a bug fix usually doesn't need a task list change — new/changed scope might).

## What this skill does not do

- It doesn't reorder or reprioritize phases — it follows the selected task list's existing structure.
- It doesn't invent new phases or checklist items on its own; if new work is discovered mid-phase that doesn't fit the existing checklist, flag it to the user rather than silently adding it.
- It doesn't proceed past a phase boundary without being told, even across separate conversations — always re-check the selected task list and the relevant phase file in the selected progress folder before assuming what's done.

---
name: structured-project-plan
description: "Turns a described project idea into a build plan that mirrors a fixed structure (Overview, Tech Stack, Core Features, Lifecycle(s), Data Model, Suggested Build Order, Open Items) — not a full PRD. Triggers on explicit invocation or right after the user finishes describing something to build."
---

## Trigger

- The user explicitly calls this skill (by name, or "make the plan", "write up the plan doc", "build the plan now").
- The user has just finished describing or brainstorming something they want to build (an app, a tool, a feature set) in the conversation, and then asks for "a plan", "the project plan", "write this up" — without asking for a formal PRD.

Do NOT trigger for: a request for a full PRD with personas / user stories / success metrics / KPIs; a request for a deep technical design doc or RFC (API contracts, infra, deployment); or planning a task list against an already-scoped codebase (defer to TASKLIST/phase-workflow conventions if present instead).

## Steps

1. Before writing anything, make sure you have (ask only for what's missing — don't stall on things the user already said):
   - Project name / one-line description, and who it's for.
   - Whether it's one piece or several sharing a backend (e.g. storefront + admin, in the reference plan).
   - Tech stack choices the user has stated; ask only about pieces they haven't specified (framework, database, ORM, storage, styling, auth). Don't silently invent a stack choice they'd care about.
   - The feature list as described, naturally grouped by area/piece of the product.
   - Whether any entity in the product has a status/lifecycle (orders, tickets, subscriptions, pre-orders, etc.) — each one gets its own lifecycle section.
   - Whether a data-model sketch is warranted — the reference plan always includes one, at the level of entities/fields/relations only (no API design, no infra).

2. Draft a single markdown file using this exact section skeleton, adapted to the project (skip a section only when it truly doesn't apply — e.g. no lifecycle section for a project with no stateful entities):

   ```
   # <Project Name> — <one-line tagline>
   ### Project Plan
   ---
   ## 1. Overview
   ## 2. Tech Stack          (a | Layer | Choice | table)
   ## 3. Core Features       (### per major area/piece; bullets, bold feature name — clause of behavior)
   ## 4 [+ 4b, 4c...]. <Entity> Lifecycle   (one per stateful entity)
   ## 5. Data Model          (schema sketch in a fenced code block + "Scalability notes" bullets)
   ## 6. Suggested Build Order   (numbered, each step with a one-clause reason for its position)
   ## 7. Open Items / Future Considerations
   ```

   Section-by-section detail:
   - **Overview**: 2–4 sentences — what it is, its parts, and the design principle that lets it extend later without restructuring.
   - **Tech Stack**: a two-column `| Layer | Choice |` table, one row per layer.
   - **Core Features**: one `###` subheading per major area or piece of the product (mirror the reference's Storefront / Admin Dashboard split whenever the project has more than one face). Under each, a bullet list — bold the feature name, then a dash and one clause of behavior. Nested bullets for feature details that need them.
   - **Lifecycle section(s)**: for every entity with a status field, a fenced-code state diagram in the reference's style (`state → state → state`, branch shown with `↘`), followed by bullets explaining each transition — including side effects like stock deduction, locking a value, or triggering a notification. Number multiple lifecycle sections 4, 4b, 4c… like the reference.
   - **Data Model**: a schema sketch in a fenced code block (Prisma-style if the stack uses Prisma/an ORM the user named; otherwise a plain entity → fields → relations list). Follow it with a "**Scalability notes**" bullet list explaining non-obvious modeling decisions: why two entities are kept separate, what gets snapshotted and why, what's never hard-deleted, how any human-readable sequential ID is generated safely under concurrency.
   - **Suggested Build Order**: a numbered list; each step names what gets built and, after a dash, one clause of why it sits at that point (e.g. "content management before storefront, since storefront depends on real data"). Close with one line on what can be reordered and under what condition.
   - **Open Items / Future Considerations**: a bullet list of things deliberately deferred, not forgotten. Group a cluster that belongs to one feature area under its own bold sub-label (mirroring "Pre-order specific:" in the reference).

3. Match the reference plan's voice: terse, declarative, no marketing language. State reasoning inline after a dash or em-dash rather than in separate prose paragraphs. Bold sparingly — field names, status values, and scope-boundary words like **never** / **not yet**.

4. This is a deliverable that leaves the conversation — save it as a markdown file and send it to the user (SendUserFile) rather than pasting the full plan into the chat reply. A short summary in the reply is fine; the file is the deliverable.

5. After delivering, ask in one line whether any section should flex (e.g. "no lifecycle needed" or "add a fourth core-feature area") rather than assuming the skeleton was exactly right on the first pass.

## Verification

- Sections 1, 2, 3, 5, 6, 7 are all present unless a section is genuinely inapplicable (say which, and why, if one is dropped).
- A lifecycle section exists for every entity in section 5 that has a status field, and only those entities.
- Section 3 (features) and section 5 (data model) agree — no feature described has no supporting entity, and no entity exists that isn't backing some described feature.
- No PRD scaffolding crept in: no persona list, no success-metrics/KPI section, no "As a user, I want..." user-story format.
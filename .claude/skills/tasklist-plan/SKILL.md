---
name: tasklist-plan
description: "Generate a phased TASKLIST.md from a structured-project-plan doc and its view-content-plan docs — the build-tracking file that phase-workflow later executes phase by phase."
---

# Tasklist Plan

## Trigger

Use when the user wants a phased, checkbox build-tracking file for a project that already has:
- A `structured-project-plan` output (Overview, Tech Stack, Core Features, Lifecycle(s), Data Model, Suggested Build Order, Open Items), and
- Zero or more `view-content-plan` docs (content-only specs for individual views/tabs/pages of the project).

Do not use this to generate the project plan itself (that's `structured-project-plan`), and do not use it to generate per-view content (that's `view-content-plan`). This skill's job is purely to sequence and checklist-ify what those two already decided.

The file this skill produces is what `phase-workflow` later consumes one phase at a time — so the output must be structured for that: numbered phases, checkbox items, a Progress Log table it can append to.

## Inputs to gather before writing anything

1. **The project plan.** Read it in full — especially the Suggested Build Order (this is the backbone of phase sequencing), the Data Model (for setup-phase checkboxes), Core Features, and Open Items (post-v1 list).
2. **Every view-content-plan doc that exists for this project.** Read each fully. Each doc's numbered content sections (e.g. "1. Overview Tab", "2. Orders Tab") become the Build checkbox items for whichever phase builds that view.
3. **If a design tool/handoff is part of this project's workflow** (e.g. screens already exist in a design tool before code), confirm with the user whether a Design-system-handoff phase and per-phase `Design:` pull-in checkboxes apply. If unclear, ask rather than assume — some projects go straight from content doc to code with no separate design step.

If a view referenced in the build order has no view-content-plan doc yet, don't invent its content from scratch — flag it and ask whether to (a) write Build items straight from the project plan's feature description instead, or (b) pause and suggest running `view-content-plan` for that view first.

## Steps

1. **Sequence phases from the Suggested Build Order.** One phase per build-order item, in the order given — the project plan already encodes the dependency reasoning (e.g. "admin product management before storefront browsing, because the storefront needs real data"). Carry that reasoning into a phase subtitle/note when it explains an otherwise-surprising order.

2. **Write each phase's checkboxes:**
   - If the phase builds a UI view with a matching view-content-plan doc: add a `**Design:**` checkbox first (only if a design-handoff step applies to this project), then one `**Build:**` checkbox per numbered content sub-section in that doc — fine-grained, roughly 1:1 with the doc's own section breakdown (list view, detail view, each major action/rule), not one flattened checkbox per whole tab.
   - If the phase has no content-plan doc (infra setup, client-side state, cross-cutting mechanics): write Build items directly from the project plan's relevant feature/data-model detail. Be specific (name the actual tables, fields, or mechanisms involved) rather than generic ("set up database" → "Install Prisma, define full schema (`X`, `Y`, `Z`)").
   - Preserve any concurrency/edge-case warnings the source docs called out (e.g. a sequence-generation race condition) as part of the relevant checkbox text, not dropped.

3. **Add a standard project tail, judged per-project, not copy-pasted blind.** Consider each of: Polish, Testing & QA, SEO & Meta, Legal & Compliance, Analytics & Monitoring, Deployment & Hosting, Launch Checklist. For each:
   - Include it if it plausibly applies (e.g. skip SEO & Meta for an internal-only admin tool with no public pages; skip Legal & Compliance only if there's genuinely no user data/commerce involved).
   - If relevance is genuinely ambiguous, ask the user rather than guessing either way.
   - Word each phase's items to the specific project (its actual stack, actual data handled) rather than using generic boilerplate.

4. **Add an Open Items section**, copied from the project plan's own Open Items (post-v1) list verbatim — don't invent new ones, don't drop any. All unchecked.

5. **Add an empty Progress Log scaffold** — the table header only (`| Date | Phase | Note |` plus the separator row), no rows. `phase-workflow` appends a row here each time it finishes a phase.

6. **Write the header block:**
   - Title: `# <Project> — Project Task List`
   - **Purpose** line: single source of truth for build progress, grouped by phase, following the Suggested Build Order in `<project-plan-filename>.md`.
   - **Companion docs** line: cross-link the project plan and every view-content-plan doc used, one clause each naming what it covers.
   - If a design-handoff step applies: a short "How design fits into this list" note explaining design is a pull-in step at the start of each UI phase, not a separate phase block.

7. **Save as `TASKLIST.md`** in the same location as the project plan and content docs.

## Verification

Before handing the file back, check:
- Every phase's checkbox items trace back to something actually stated in the project plan or a content-plan doc — nothing invented.
- Phase order matches the project plan's Suggested Build Order and its stated dependency reasoning.
- Every UI-building phase with a content-plan doc has fine-grained Build items matching that doc's own section breakdown, not a single flattened item.
- Tail phases (Testing, SEO, Legal, Analytics, Deployment, Launch, Polish) are each a deliberate include/exclude call, not a blind copy of a template — and their item wording is specific to this project, not generic boilerplate.
- Open Items exactly matches the project plan's post-v1 list — same items, none added or dropped.
- Progress Log is present with header only, no fabricated rows.
- All checkboxes are unchecked (`- [ ]`) since nothing has been built yet — this file is the starting point `phase-workflow` will check items off in, not a record of work already done.
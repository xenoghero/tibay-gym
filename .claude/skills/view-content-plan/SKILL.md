---
name: view-content-plan
description: "Generate a content-only spec for one view/page (e.g. admin dashboard tab, landing page section) from a structured-project-plan doc — what information and actions exist, no layout or design decisions."
---

# View Content Plan

## Trigger

Use this skill when the user wants a **content-only** specification for a single view/page/screen of a project that already has a `structured-project-plan`-style project plan (data model, features, lifecycle). Trigger phrases: "write the content for the [view]", "flesh out [admin dashboard / landing page / X tab] content", "content plan for [view]", or a direct request referencing this skill.

Do **not** trigger this skill for:
- Generating the original project plan from an idea (that's `structured-project-plan`).
- Any layout, wireframe, visual hierarchy, component styling, or responsive-behavior work — that is explicitly out of scope and belongs to a design step.
- Implementing/building the view in code (that's `phase-workflow` / the build phases in TASKLIST.md).

## Scope discipline (read this before drafting anything)

This skill produces **content only**: what information lives on the view, what actions can be taken, what the copy/wording says, what business rules affect what's shown, what data each field needs. It never produces:

- Layout descriptions (columns, grids, positioning, "desktop vs mobile" arrangement)
- ASCII wireframes or box diagrams
- Visual hierarchy, spacing, or component styling calls
- Color, typography, or design-system decisions

If you catch yourself writing "two-column layout" or drawing a box diagram, stop — that content belongs in a separate design pass, not this doc. (This is the same boundary the admin-dashboard-content.md reference draws explicitly in its own scope note — follow that model, not the landing-page-content-layout doc's mixed layout+content style.)

## Steps

1. **Identify inputs.** Confirm you have:
   - The project's `structured-project-plan` output (data model, lifecycle(s), feature list, build order) — read it if not already in context.
   - Any existing companion content docs for other views in the same project (read them for tone, conventions, and to avoid contradicting locked decisions — e.g. currency format, terminology, status names).
   - The single view/page this run targets. If the user named more than one view, confirm you're doing exactly one this run and ask which to start with.

2. **Ask clarifying questions before drafting.** Do not write the content doc on a first pass. Ask a batched set of questions (AskUserQuestion if available, otherwise plain text) covering:
   - Scope boundaries: what's explicitly in vs. out for v1 on this view (e.g. "single admin login, no roles" style decisions).
   - Any fields/data not fully specified by the project plan's data model that this view needs to surface or collect.
   - Business rules that affect content/copy: what triggers what, what's editable when, what's locked and why.
   - Edge cases worth naming explicitly: empty states, error conditions, destructive actions needing confirmation copy.
   - Terminology/conventions to reuse from sibling content docs (status names, currency format, date/time display rules) so docs don't drift.
   Write down the answers as a "Decisions locked" list — this becomes the top of the doc.

3. **Draft using the fixed template** (see Template below). Every section is content-only: field lists, copy strings, business rules, and available actions — never layout.

4. **Save the file** as `<view-name>-content.md` (kebab-case, e.g. `admin-dashboard-content.md`, `checkout-page-content.md`) in the same location as the project plan and sibling content docs. Add a "Companion docs" line at the top cross-linking the project plan and any sibling content docs, matching the existing convention in this project's docs.

5. **Surface anything still unresolved** as its own section near the end ("Remaining Concern" or an open question) rather than guessing — mirror how admin-dashboard-content.md flags the shipping-fee business risk instead of silently deciding it.

## Template (fixed structure — reuse for every view)

```markdown
# <Project> — <View Name>: Content Plan

**Scope of this document:** what information lives on this view and what actions can be taken. Layout, visual hierarchy, component styling, and responsive behavior are deliberately out of scope.

**Companion docs:** `<project-plan>.md` (data model, lifecycle) · <sibling content docs>

---

## Decisions locked
- <bullet list of settled scope/behavior decisions from the clarifying-question pass>

---

## 0. Global / Cross-cutting Content
<applies-to-everything content: persistent chrome, conventions (currency/date/timezone format), terminology>

---

## 1..N. <Each section / tab / sub-view>
For each: what's shown (fields, columns, data), filters/search/sort available, what actions exist and what they do, what confirmations/copy they require, business rules that affect the content (e.g. "locked once X happens").

---

## Cross-cutting Content Requirements
- Empty states (plain language, per list — distinguish "nothing exists" vs "nothing matches filters")
- Confirmations required before destructive/impactful actions (name the specific item/effect)
- Error messages needing specific wording
- Feedback required after every save/status change/deletion

---

## Out of Scope for v1
<explicitly excluded features/content, so the boundary is visible>

---

## Resolved Decisions
<table of previously-open questions and their answers>

### Schema implications
<any additions/changes this view's content implies for the data model, if any>

---

## Remaining Concern (if any)
<flag anything content couldn't resolve — a business decision, an ambiguity — rather than silently deciding it>
```

## Verification

Before handing the doc back, check:
- No "Layout" subsections, wireframes, box diagrams, column/grid descriptions, or styling language appear anywhere.
- Every list/view mentioned has an empty state, and destructive actions have confirmation copy.
- Terminology (status names, currency format, date/time rules) matches sibling content docs for the same project rather than introducing new conventions.
- The "Decisions locked" section reflects what the user actually answered in step 2, not assumptions.
- Anything genuinely unresolved is called out explicitly, not quietly decided.
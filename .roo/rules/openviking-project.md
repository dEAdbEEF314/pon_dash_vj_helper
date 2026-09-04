# openviking-project

## Rules for Using OpenViking in the Pon Dash VJ Helper (PDVH) Project

### Purpose
This file defines how OpenViking is used specifically for the Pon Dash VJ Helper project. It complements the global `openviking-usage.md` rule by defining project-specific storage locations, data structure, and granularity for project knowledge.

### Storage Location
All PDVH-specific knowledge is stored under: `viking://resources/pon_dash_vj_helper/`

#### Directory Structure
```
viking://resources/pon_dash_vj_helper/
├── architecture.md          # High-level architecture and design decisions (with rationale, alternatives considered, trade-offs accepted)
├── decisions/             # ADR (Architecture Decision Records) — one file per decision
│   └── YYYY-MM-DD-decision-slug.md
├── references/            # External specs, API docs, and reference material summaries
│   └── YYYY-MM-DD-reference-slug.md
├── glossary.md            # Project-specific terminology and definitions
└── .abstract.md           # Auto-generated overview (do not edit manually)
```

### What to Save (PDVH-specific)
- Design decisions and their rationale (why a choice was made, what alternatives were considered, what trade-offs were accepted)
- Stable project facts likely to be needed again (API specs, data structures, configuration details, constraints)
- Investigation results and findings that took effort to uncover
- Rules or policies that apply across projects (naming conventions, patterns, architectural principles)

### What NOT to Save (PDVH-specific)
- Transient or ephemeral information (current task state, in-progress debugging steps, temporary notes)
- Code itself (source files belong in the workspace, not in memory)
- Generated artifacts (logs, screenshots, test reports, result files)
- Anything already stored in a workspace file that can be re-read

### Search Habit
Before starting any investigation or task, run `search`/`find` against OpenViking in parallel with workspace file searches. This avoids duplicate storage and surfaces prior work quickly.

### Naming Convention
- Use kebab-case for all file and directory names
- Use ISO 8601 dates (`YYYY-MM-DD`) as prefixes for dated entries
- Keep descriptions concise and actionable
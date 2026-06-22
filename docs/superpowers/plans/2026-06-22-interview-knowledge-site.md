# Interview Knowledge Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a root-level Astro Starlight documentation skeleton for interview preparation knowledge.

**Architecture:** The site uses Starlight for navigation and Markdown rendering. Content is split into `roadmap`, `knowledge`, `interview`, and `templates` sections, with the original reference file retained as source material.

**Tech Stack:** Astro, Starlight, Markdown, Node.js verification script.

---

## File Structure

- Create `package.json` for scripts and dependencies.
- Create `astro.config.mjs` for Starlight configuration and sidebar groups.
- Create `tsconfig.json` for Astro TypeScript defaults.
- Create `src/content/docs/index.mdx` for the site landing page.
- Create section files under `src/content/docs/roadmap/`, `knowledge/`, `interview/`, and `templates/`.
- Create `scripts/verify-docs-skeleton.mjs` to verify required files and config text.
- Modify `README.md` to describe local development and update workflow.

### Task 1: Skeleton Verification Script

**Files:**
- Create: `scripts/verify-docs-skeleton.mjs`

- [ ] **Step 1: Write the failing verification script**

Create a Node script that checks for required site files, content files, and config markers.

- [ ] **Step 2: Run verification to confirm it fails before the site exists**

Run: `node scripts/verify-docs-skeleton.mjs`

Expected: failure reporting missing files such as `package.json` and `astro.config.mjs`.

### Task 2: Astro Starlight Scaffold

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`

- [ ] **Step 1: Add root package metadata and scripts**

Scripts:
- `dev`: start Astro dev server.
- `build`: build the static site.
- `preview`: preview built output.
- `check:skeleton`: run the verification script.

- [ ] **Step 2: Add Starlight config**

Configure title, social links, and sidebar groups for Roadmap, Knowledge, Interview, and Templates.

- [ ] **Step 3: Add Astro TypeScript config**

Extend `astro/tsconfigs/strict`.

### Task 3: Documentation Content Skeleton

**Files:**
- Create: `src/content/docs/index.mdx`
- Create: pages under `src/content/docs/roadmap/`
- Create: pages under `src/content/docs/knowledge/`
- Create: pages under `src/content/docs/interview/`
- Create: pages under `src/content/docs/templates/`

- [ ] **Step 1: Create the home page**

Describe the site purpose and update workflow.

- [ ] **Step 2: Create roadmap pages**

Cover overview, schedules, priorities, demos, and outputs.

- [ ] **Step 3: Create knowledge pages**

Create one Markdown page per main technical domain from the source outline.

- [ ] **Step 4: Create interview pages**

Create pages for resume defense, project retrospectives, question bank, and boundary expression.

- [ ] **Step 5: Create templates**

Create daily, weekly, and AI-fill templates.

### Task 4: README and Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document commands**

Add install, dev, build, and skeleton check commands.

- [ ] **Step 2: Run the skeleton check**

Run: `npm run check:skeleton`

Expected: success.

- [ ] **Step 3: Install dependencies and build**

Run: `npm install`

Run: `npm run build`

Expected: successful static build.

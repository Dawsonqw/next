# Interview Knowledge Site Design

## Goal

Build an Astro Starlight static documentation site in the repository root for maintaining interview preparation knowledge derived from `reference/简历面试学习计划.md`.

## Information Architecture

The site uses a long-term knowledge-base structure instead of mirroring the original file as one large page:

- `roadmap/`: learning route, schedules, priorities, and required deliverables.
- `knowledge/`: technical domains such as C++/Linux, trading systems, model deployment, MLIR, graph optimization, quantization, edge NPU deployment, LLM inference, Agent/RAG, and OpenGL.
- `interview/`: resume defense table, project retrospectives, interview question lists, and boundary-safe expression guidance.
- `templates/`: daily learning, weekly review, and AI-fill prompt templates.

The original `reference/简历面试学习计划.md` remains unchanged as source material.

## Content Strategy

Each generated page starts as a structured skeleton with:

- a clear purpose,
- sections for core concepts,
- sections for engineering details,
- sections for interview questions,
- placeholders for later expansion.

The pages are designed for two update modes:

- manual edits directly in Markdown files under `src/content/docs/`;
- AI-assisted local filling that updates Markdown, then gets committed and pushed.

## Technical Design

The project is a root-level Astro Starlight site using:

- `astro`
- `@astrojs/starlight`
- Markdown/MDX content in `src/content/docs/`
- a small Node verification script to assert that required skeleton files exist

No custom frontend application logic is required for the first version. The initial design keeps Starlight defaults so the site remains easy to maintain.

## Verification

The first version is considered valid when:

- the required skeleton files exist;
- the Astro configuration defines the expected Starlight title and sidebar groups;
- `npm run check:skeleton` passes;
- `npm run build` completes successfully.

@AGENTS.md

# fuckexam — CLAUDE.md

AI exam readiness coach. Students upload course materials, get a study path, study stage by stage, get tested, and track their progress toward exam readiness.

**Product name**: fuckexam — internal, external, and on the website.

---

## CRITICAL: Next.js 14 Pages Router — Not the App Router

This project uses **Next.js 14** with the **Pages Router**. It is NOT using the App Router (no `app/` directory exists). Violations here will silently break routing.

### Pages Router — key facts

| Thing | App Router | This project (Pages Router) |
|-------|-----------|---------------------------|
| Routing | `app/` directory | `pages/` directory |
| Global layout | `app/layout.tsx` | `pages/_app.tsx` |
| Custom HTML shell | n/a | `pages/_document.tsx` |
| Page metadata | `export const metadata` | `<Head>` from `next/head` |
| Data fetching | Server Components / `fetch()` | `getStaticProps` / `getServerSideProps` / client-side |
| Router hook | `useRouter` from `next/navigation` | `useRouter` from `next/router` |
| Server/client split | `"use client"` / `"use server"` | Not applicable — all components are client by default |
| API routes | `app/api/route.ts` with `Response` | `pages/api/*.ts` with `(req, res)` handler |
| Link API | Same as Pages Router | `<Link href="...">text</Link>` — NO `<a>` child needed (removed in v13+) |

### File structure for routing

```
pages/
  _app.tsx          ← global wrapper + global CSS import
  _document.tsx     ← custom HTML shell (fonts, lang)
  index.tsx         ← home / dashboard  (route: /)
  subjects/
    [id].tsx        ← subject page      (route: /subjects/[id])
    [id]/
      path.tsx      ← study path        (route: /subjects/[id]/path)
      stages/
        [stageId].tsx ← stage study     (route: /subjects/[id]/stages/[stageId])
      mastery.tsx   ← mastery map       (route: /subjects/[id]/mastery)
  api/
    subjects/
      index.ts      ← POST /api/subjects
      [id].ts       ← GET/PATCH /api/subjects/[id]
    stages/
      [id]/
        content.ts  ← POST /api/stages/[id]/content
        quiz.ts     ← POST /api/stages/[id]/quiz
        recall.ts   ← POST /api/stages/[id]/recall
    upload.ts       ← POST /api/upload
    topics.ts       ← POST /api/topics (extract from material)
    path.ts         ← POST /api/path (generate study path)
    mastery.ts      ← PATCH /api/mastery (update topic level)
    readiness.ts    ← GET /api/readiness/[subjectId]
```

### API route pattern (Next.js 9)

```typescript
// pages/api/example.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // handle POST
    return res.status(200).json({ ok: true })
  }
  res.setHeader('Allow', ['POST'])
  res.status(405).end('Method Not Allowed')
}
```

### The `app/` directory

The `app/` directory has been deleted. Do not recreate it. All pages go in `pages/`, global CSS is imported in `pages/_app.tsx`.

### The nested `fuckexam/fuckexam/` directory

There is a nested `fuckexam/` directory inside the project root — it is an artifact, not a second app. Ignore it.

---

## Tailwind CSS v4

This project uses Tailwind CSS v4, which differs from v3.

- No `tailwind.config.js` needed for basic use
- CSS entry is `@import "tailwindcss"` (not `@tailwind base/components/utilities`)
- Theme customisation uses `@theme inline {}` blocks in CSS
- Utility classes work the same as v3
- Global CSS file: `styles/globals.css` — imported once in `pages/_app.tsx`
- PostCSS config: `postcss.config.mjs` uses `@tailwindcss/postcss`

---

## Tech Stack

| Layer | Tool | Notes |
|-------|------|-------|
| Framework | Next.js 14 | Pages Router only — see above |
| Language | TypeScript 5 | Strict mode enabled |
| Styling | Tailwind CSS v4 + Framer Motion | |
| Icons | Lucide React | |
| Class util | `clsx` + `tailwind-merge` | Use `cn()` helper |
| Validation | Zod v4 | Use for all API request/response shapes |
| Database | Supabase (Postgres + pgvector) | Auth, storage, vector search |
| AI | OpenAI SDK v6 | See model assignments below |
| Auth | Supabase Auth (magic link) | |
| File storage | Supabase Storage | |

---

## Environment Variables

Required in `.env.local` (never commit):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-side only, never expose to client
OPENAI_API_KEY=                # server-side only
```

- `NEXT_PUBLIC_*` variables are exposed to the browser — only put non-secret values there
- `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-only (used in API routes, never in page components)

---

## Database Schema (Supabase + pgvector)

The `vector` extension must be enabled: `create extension if not exists vector;`

```sql
-- subjects: a student's enrolled exam
create table subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  exam_date date,
  exam_format_text text,   -- student's free-text description of exam format
  created_at timestamptz default now()
);

-- materials: uploaded files per subject
create table materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references subjects on delete cascade not null,
  file_name text not null,
  storage_path text not null,
  processed_at timestamptz
);

-- chunks: parsed + embedded text chunks from materials
create table chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials on delete cascade not null,
  content text not null,
  embedding vector(1536),   -- text-embedding-3-small
  metadata jsonb            -- {heading, page, chunk_index}
);
create index on chunks using ivfflat (embedding vector_cosine_ops);

-- topics: key topics extracted from a subject's materials
create table topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references subjects on delete cascade not null,
  name text not null,
  description text,
  weight float default 0.5,   -- 0.0–1.0 from extraction
  display_order int
);

-- study_stages: ordered stages in a subject's study path
create table study_stages (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references subjects on delete cascade not null,
  name text not null,
  topic_ids uuid[],
  stage_order int not null,
  estimated_minutes int,
  status text default 'not_started',  -- not_started | in_progress | complete | needs_review
  material_types text[],   -- summary | flashcards | concept_map
  test_types text[]        -- recall | mcq
);

-- generated_items: cached AI-generated content per stage
create table generated_items (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid references study_stages on delete cascade not null,
  type text not null,    -- summary | flashcards | concept_map
  content jsonb not null,
  created_at timestamptz default now()
);

-- questions: recall prompts and MCQs per stage
create table questions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid references study_stages on delete cascade not null,
  topic_id uuid references topics,
  type text not null,    -- mcq | recall
  content jsonb not null,  -- {question, options[], correct_index, explanation} for MCQ
  created_at timestamptz default now()
);

-- student_answers: student responses to questions
create table student_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  question_id uuid references questions not null,
  answer_text text,
  score text,   -- correct | partial | wrong
  feedback jsonb,
  answered_at timestamptz default now()
);

-- mastery_records: per-topic confidence level per user
create table mastery_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  topic_id uuid references topics not null,
  level text default 'grey',   -- grey | green | yellow | red
  updated_at timestamptz default now(),
  unique(user_id, topic_id)
);

-- readiness_snapshots: point-in-time readiness scores
create table readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  subject_id uuid references subjects not null,
  score float,   -- 0–100
  computed_at timestamptz default now()
);
```

### Row Level Security

Enable RLS on all tables. Standard pattern:
```sql
alter table subjects enable row level security;
create policy "users own their subjects"
  on subjects for all using (auth.uid() = user_id);
```
Apply equivalent policies to all user-data tables. `chunks`, `topics`, `study_stages`, `generated_items`, `questions` are readable by any user who owns the parent subject.

### Supabase client helpers

```typescript
// lib/supabase/client.ts — browser-side
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// lib/supabase/server.ts — API routes only (service role)
import { createClient } from '@supabase/supabase-js'
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

---

## AI Model Assignments

| Task | Model | Notes |
|------|-------|-------|
| Embedding | `text-embedding-3-small` | 1536 dimensions, pgvector |
| Topic extraction | `gpt-4o` | Reads full material, outputs topic list |
| Study path generation | `gpt-4o` | Reads topics + exam format, outputs stages |
| Summary generation | `gpt-4o-mini` | RAG-grounded, templated |
| Flashcard generation | `gpt-4o-mini` | RAG-grounded, templated |
| Concept map generation | `gpt-4o-mini` | RAG-grounded, text tree format |
| MCQ quiz generation | `gpt-4o-mini` | RAG-grounded, structured output |
| Active recall scoring | `gpt-4o-mini` | Scores against retrieved context |

All generated items (summary, flashcards, concept map, questions) are **cached in the DB**. Check before generating — never regenerate content that already exists.

### OpenAI client

```typescript
// lib/openai.ts
import OpenAI from 'openai'
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
```

### Structured output pattern (use Zod schemas)

```typescript
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'

const TopicSchema = z.object({
  topics: z.array(z.object({
    name: z.string(),
    description: z.string(),
    weight: z.number().min(0).max(1),
  }))
})

const response = await openai.chat.completions.parse({
  model: 'gpt-4o',
  messages: [...],
  response_format: zodResponseFormat(TopicSchema, 'topics'),
})
const { topics } = response.choices[0].message.parsed!
```

---

## Product Philosophy (Non-Negotiable)

1. **The study path controls generation.** Content is only generated inside a specific stage. There is no global "generate summary" button. No generating random content before the path exists.

2. **The exam format controls the path.** The AI reads the student's exam format before building the study path. The path structure and content types reflect what the exam actually demands.

3. **After every action, the student knows exactly what to do next.** Every screen has one primary CTA. The Next Best Task is always visible on the Subject page.

4. **Mastery states are four, not two.** Grey = not started. Red = attempted, weak (<50%). Yellow = shaky (50–79%). Green = solid (≥80%). Grey topics are excluded from the readiness score denominator.

5. **Readiness score = count(green topics) / count(attempted topics) × 100.** Simple and honest. Recomputed after every quiz session.

6. **Never regenerate cached content.** Always check `generated_items` before calling the AI. Summaries, flashcards, concept maps, and questions are written once and reused.

---

## Next Best Task Algorithm

Priority order:
1. Continue current stage if in progress
2. Repair red topics from already-completed stages
3. Start next unstarted stage
4. Broadly review red/yellow topics only when all stages done OR exam ≤ 7 days away

A single wrong answer does not pull the student out of their current stage. Repair is scoped to completed stages first.

---

## Four MVP Screens

1. **Subject Dashboard** (`pages/index.tsx`) — subject cards + "Continue now" banner
2. **Study Path** (`pages/subjects/[id]/path.tsx`) — stage roadmap + Next Best Task at top
3. **Stage Study** (`pages/subjects/[id]/stages/[stageId].tsx`) — Summary / Flashcards / Concept Map tabs + Test Me
4. **Mastery** (`pages/subjects/[id]/mastery.tsx`) — readiness score bar + mastery grid + mistake log

---

## Coding Rules

- Use `cn()` for all className construction: `import { cn } from '@/lib/utils'` (clsx + twMerge)
- Validate all API request bodies with Zod before processing
- Never access `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` in page components — only in `pages/api/`
- No comments unless the reason is non-obvious
- No placeholder UI — every screen must be functionally complete before moving on
- Framer Motion for transitions and flashcard flips only — no gratuitous animation

---

## Key Commands

```bash
npm run dev      # start dev server (requires .env.local + pages/ directory)
npm run build    # production build
npm run lint     # eslint
```

---

## MCP Tools Available

The `mcp__supabase__*` MCP tools are available for all Supabase operations:
- `mcp__supabase__list_projects` — list Supabase projects
- `mcp__supabase__apply_migration` — run SQL migrations
- `mcp__supabase__execute_sql` — run ad-hoc SQL
- `mcp__supabase__generate_typescript_types` — regenerate types from schema
- `mcp__supabase__get_project_url` / `mcp__supabase__get_publishable_keys` — get env var values

Use these instead of the Supabase CLI when possible. Always use `mcp__supabase__apply_migration` (not `execute_sql`) for schema changes so they appear in the migration history.

---

## Before Starting Any Task

1. Identify which `pages/` file is affected
2. Check if generated content exists before triggering AI generation
3. Confirm the API route uses `(req, res)` pattern (not App Router `Response` pattern)
4. Confirm any hook imports come from `next/router` not `next/navigation`

export const PROMPTS = {
  extractTopics: (materialText: string) => `
You are an expert at analyzing university course materials.
Extract the key topics a student needs to study for an exam from this material.

For each topic provide:
- name: short name (2-5 words)
- description: what this topic covers (1-2 sentences)
- weight: importance 0.0-1.0 based on emphasis in the material

Return 5-12 topics ordered foundational to advanced.

Material:
${materialText.slice(0, 12000)}
`.trim(),

  generatePath: (topics: string, examFormat: string) => `
You are a curriculum designer creating a university exam study path.

Think of each stage as a CHAPTER in a well-structured textbook. Each chapter has ONE clear learning objective and assumes the student has fully mastered all previous chapters.

CRITICAL CURRICULUM RULES:
1. Every concept belongs to EXACTLY ONE stage — the first stage where it is needed
2. Later stages ASSUME mastery of all earlier stages. Never re-introduce, re-define, or revisit a concept that appeared in a previous stage
3. Order stages so that no stage requires knowledge from a later stage (strict prerequisite ordering)
4. Stage names must describe WHAT IS NEW in that stage — not restate general themes
5. Split concepts that are commonly conflated: teach the DEFINITION in one stage, the MECHANISM in the next, the APPLICATION in the third
6. 1-3 tightly scoped NEW concepts per stage — err on the side of narrower stages over broader ones

BAD (what to avoid):
- Stage 1: "IPC Basics" — covers IPC, race conditions, critical regions, mutual exclusion (too broad, all concepts at same level)
- Stage 2: "Critical Regions" — re-covers critical regions and mutual exclusion from Stage 1

GOOD (what to produce):
- Stage 1: "Why Processes Need IPC" — covers IPC motivation and shared resource problems only
- Stage 2: "Race Conditions and the Critical Region Problem" — covers race conditions, critical regions (ASSUMES Stage 1)
- Stage 3: "Mutual Exclusion: The Solution" — covers mutual exclusion requirements and properties (ASSUMES Stage 1+2)
- Stage 4: "Implementing Mutual Exclusion" — covers locks, busy waiting, strict alternation (ASSUMES Stage 1-3)

Settings:
- material_types: choose from ["summary", "flashcards", "concept_map"]
- test_types: always include ["recall", "mcq"]
- Estimate realistic study time 15-60 min per stage
- Align content depth with exam format: ${examFormat}

Topics to sequence (JSON):
${topics}

Exam format: ${examFormat}
`.trim(),

  generateSummary: (topicNames: string, examFormat: string, context: string, curriculumContext?: string) => `
You write structured study guides for university students preparing for exams.

Exam: ${examFormat}
${curriculumContext ? `
═══════════════════════════════════════════
FULL CURRICULUM MAP (READ CAREFULLY):
${curriculumContext}
═══════════════════════════════════════════

YOUR SCOPE IS STRICTLY LIMITED to the concepts marked [CURRENT STAGE] above.
- Concepts marked [ALREADY COVERED]: the student knows these — do NOT define or re-explain them. You may reference them as prerequisites.
- Concepts marked [COVERED LATER]: do NOT introduce, define, preview, or explain these. They will be taught in future stages. You may say "this leads to [topic], which you will study next" but never explain what they are.
- Everything in your output must be about the [CURRENT STAGE] concepts ONLY.
` : `Topics for this stage: ${topicNames}`}

Return a JSON object with these exact fields:
- quickOverview: array of 5-8 short strings — the bare minimum facts about ${topicNames} the student must know, nothing from other stages
- bigIdea: one paragraph (2-4 sentences) explaining the core idea of this stage and how it fits in the learning journey
- keyConcepts: array of 3-6 objects — CRITICAL: the "term" field must be a concept explicitly listed under [CURRENT STAGE] in the curriculum map, or a direct sub-component of it. NEVER write a concept card for anything listed under [ALREADY COVERED] or [COVERED LATER]. If a concept appears in your source material but belongs to another stage, do not define it — mention it in prose only as a forward/backward reference.
  Each object has:
  - term: ONLY a [CURRENT STAGE] concept name
  - explanation: 1-2 sentences defining it clearly
  - whyItMatters: one sentence on why this is tested in: ${examFormat}
- ideaConnections: array of 2-4 objects showing how this stage's concepts relate to each other or to prior knowledge, each with:
  - from: a concept name
  - to: a concept name
  - relationship: e.g. "leads to", "enables", "contrasts with", "is required by", "causes"
- examTraps: array of 2-3 common mistakes students make specifically about ${topicNames}, each with:
  - trap: the wrong belief
  - correction: what is actually true
- quickCheck: array of 2-3 questions testing the [CURRENT STAGE] material only, each with:
  - question: a short self-test question
  - answer: the correct answer (1-2 sentences)
- detailedNotes: 200-300 word markdown string about the current stage content only — no headings, **bold** key terms, "- " bullets for lists

Use only the source material provided. Do not invent facts.

Source material:
${context}
`.trim(),

  generateFlashcards: (topicNames: string, examFormat: string, context: string, curriculumContext?: string) => `
Generate 8 flashcard Q&A pairs for exam preparation.
Exam type: ${examFormat}
${curriculumContext ? `
CURRICULUM MAP:
${curriculumContext}

Write cards ONLY for the [CURRENT STAGE] concepts.
Do NOT write cards that test [ALREADY COVERED] concepts — the student knows those.
Do NOT write cards that test [COVERED LATER] concepts — those haven't been taught yet.
` : `Topics: ${topicNames}`}

For each card:
- front: a specific question that tests understanding or application (avoid "What is X?" — test relationships, causes, consequences)
- back: a concise answer (1-3 sentences max)

Use only the provided source material.

Source material:
${context}
`.trim(),

  generateConceptMap: (topicNames: string, context: string, curriculumContext?: string) => `
Generate a learning concept map strictly scoped to this stage's concepts.
${curriculumContext ? `
CURRICULUM MAP:
${curriculumContext}

Your map covers ONLY the [CURRENT STAGE] concepts.
[ALREADY COVERED] concepts may appear as small reference nodes if they are direct prerequisites, but must not be the focus.
[COVERED LATER] concepts must NOT appear in the map at all.
` : `Topics: ${topicNames}`}

Return a JSON object with:
- title: short descriptive title for this map (4-8 words)
- nodes: array of 6-14 nodes, each with:
  - id: short snake_case identifier (e.g. "tcp_reliability", "osi_layer")
  - label: concept name (2-5 words)
  - detail: one sentence explaining this node
  - type: exactly one of: concept | problem | solution | exam_trap | process | definition | comparison | limitation | evidence | formula | example | code_example
  - importance: exactly one of: primary | secondary | supporting
    (primary = core exam concept; secondary = important supporting idea; supporting = background detail or example)
- relationships: array of 5-12 connections, each with:
  - from: a node id
  - to: a node id
  - label: exactly one of: "leads to" | "solves" | "causes" | "enables" | "contrasts with" | "is part of" | "requires" | "produces" | "defines" | "exemplifies"

Rules:
- Every node must appear in at least one relationship
- Relationships should reflect the actual logical flow of the topic (not just association)
- Order relationships so they trace from foundational → applied concepts
- Do not invent content not in the source material

Source material:
${context}
`.trim(),

  generateMCQ: (topicNames: string, examFormat: string, context: string) => `
Generate exactly 3 multiple-choice questions for: ${topicNames}
Exam type: ${examFormat}

Requirements:
- Test understanding and application, not just memorization
- 4 options per question
- Distractors should reflect common misconceptions
- Match the style and difficulty of: ${examFormat}

Source material:
${context}
`.trim(),

  generateRecallPrompts: (topicNames: string, context: string) => `
Generate 3 active recall prompts for a student studying: ${topicNames}

Each prompt should:
- Require the student to retrieve information from memory (not just recognize it)
- Target the most important exam concepts
- Include an ideal answer and 3-5 key points that must be mentioned for full marks

Source material:
${context}
`.trim(),

  scoreRecall: (prompt: string, keyPoints: string[], studentAnswer: string, sourceContext: string) => `
Grade this student's recall answer.

Prompt: ${prompt}
Key points required: ${keyPoints.join(', ')}
Student answered: "${studentAnswer}"

Score as:
- "correct": covers all key points adequately
- "partial": covers some key points, shows understanding
- "wrong": misses most key points or shows fundamental misunderstanding

Also provide:
- correct_parts: key points the student got right
- missing_parts: key points the student missed
- source_quote: a short quote from the source that directly answers the prompt

Source context:
${sourceContext}
`.trim(),
}

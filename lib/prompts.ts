export const PROMPTS = {
  buildSubject: (materialSample: string, examFormat: string, subjectName: string) => `
You are a curriculum designer building a university exam study system.

Subject: ${subjectName}
Exam format: ${examFormat}

STEP 1 — Extract 5–12 topics from the material sample below:
- name: 2–5 words, precise and distinct
- description: 1–2 sentences on what this topic covers
- weight: 0.0–1.0 based on how much emphasis the material places on it

STEP 2 — Create an ordered study path from EXACTLY those topics.
Think of each stage as a CHAPTER in a well-structured textbook.

CRITICAL CURRICULUM RULES:
1. Every concept belongs to EXACTLY ONE stage — the first stage where it is needed
2. Later stages ASSUME mastery of all earlier stages. Never re-introduce, re-define, or revisit a concept from a previous stage
3. Order stages so that no stage requires knowledge from a later stage
4. Stage names must describe WHAT IS NEW in that stage — not restate general themes
5. 1–3 tightly scoped NEW concepts per stage — narrow is better than broad
6. Every topic_name in stages must exactly match a name from Step 1

Settings per stage:
- material_types: choose from ["summary", "flashcards", "concept_map"]
- test_types: always include ["recall", "mcq"]
- estimated_minutes: realistic study time 15–60 min per stage

Material sample:
${materialSample}
`.trim(),

  generateQuizBundle: (topicNames: string, examFormat: string, context: string) => `
Generate a quiz bundle for: ${topicNames}
Exam type: ${examFormat}

Return:
- mcqs: exactly 5 multiple-choice questions, each with:
  - question, options (array of exactly 4 strings), correct_index (0–3), explanation
  - Test understanding and application, not memorisation
  - Distractors should reflect common misconceptions
- recalls: exactly 1 active recall prompt:
  - prompt: a short open-ended question requiring retrieval from memory (not just recognition)
  - ideal_answer: the complete ideal answer
  - key_points: 3–5 specific points required for full marks

Use only the provided source material.

Source material:
${context}
`.trim(),

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
- The map must have exactly one root node — the single most foundational concept or problem in the topic. The root is the ONLY node permitted to have no incoming edges.
- The root MUST be a concept or problem node — NEVER a solution, process, example, definition, or limitation node. Solutions and methods must appear DOWNSTREAM of the problems they address.
- If the stage topic involves preventing or solving X, then X (the problem/concept) is the root. Solutions branch off from problems, not the other way around.
- Every primary and secondary node that is NOT the root MUST appear at least once as the "to" target in the relationships array — something must point INTO it.
- All nodes must be reachable from the root via the relationships chain — do not produce disconnected clusters.
- Relationships must reflect real cause/effect, prerequisite, or part-whole logic from the source material (not superficial association).
- Order relationships so they trace from foundational → applied concepts.
- Self-check before returning: identify the single indegree-0 node (your root). For every other node with importance "primary" or "secondary", confirm its id appears in at least one relationship's "to" field. If not, add a relationship from a logically earlier concept.
- Do not invent content not in the source material.

Node type selection — use the most specific type, never default to "definition":
- concept: an abstract principle or idea (e.g. "Mutual Exclusion", "Race Condition")
- problem: a known failure mode, risk, or issue that needs solving (e.g. "Priority Inversion", "Race Condition")
- solution: a mechanism, approach, or algorithm that addresses a problem (e.g. "Blocking", "Mutex Lock")
- process: a step-by-step method or procedure (e.g. "Strict Alternation", "Busy Waiting loop")
- limitation: a known drawback or constraint of a method (e.g. "CPU waste from busy waiting")
- exam_trap: a common misconception or mistake students make about this topic
- example: a concrete instantiation that exemplifies one specific method or concept — NOT the whole topic
- definition: ONLY for a node that IS the formal definition of the root concept. Use at most once per map. Do NOT use for methods, approaches, techniques, conditions, or principles — use concept/process/solution/limitation instead.

Relationship label semantics — use the most semantically precise label from the allowed set:
- "requires": ONLY for necessary prerequisites. A "requires" B means B must already exist for A to function. Do NOT use this from a concept to a problem it produces, or to a solution/method that addresses it.
- "causes": when one concept directly produces a problem or side effect (concept → problem). Also use when something creates a risk or limitation in another thing.
- "solves": direction is always [solution/method node] → "solves" → [problem node]. Use when a method prevents or resolves a problem.
- "enables": when one concept makes another possible or practical. Use to express "X is implemented by Y" as Y "enables" X's goal.
- "produces": when a process or method generates an output or result.
- "leads to": ordered causal or sequential chain (step A leads to step B in a process or sequence).
- "defines": strict definitional relationship only — use sparingly.
- "exemplifies": for concrete examples or instances. Connect the example node to the SPECIFIC method or concept it illustrates — NEVER directly to the root or a broad ancestor.
- "is part of": for component/whole or subtype membership.
- "contrasts with": only for comparison nodes.
Type-pair rules — enforce correct direction per node type combination:
- concept/definition → problem: use "causes" or "leads to" (NEVER "requires")
- solution/process → problem: use "solves" — direction always [solution] → "solves" → [problem]
- problem → solution: use "leads to" (the problem motivates the solution)
- process/example → specific concept or process: use "exemplifies" or "is part of"
- concept → concept: use "requires", "enables", or "is part of"
- limitation → process/solution: use "is part of" or "leads to"
Common mistakes that produce a broken flow:
- Using "requires" from a concept to a problem it generates, or to a solution that handles it.
- Connecting example or code_example nodes directly to the root instead of to the specific method they illustrate.
- Problem nodes should have a "causes" incoming edge from what creates them, and a "solves" outgoing from whatever fixes them.

Source material:
${context}
`.trim(),

  generateMCQ: (topicNames: string, examFormat: string, context: string) => `
Generate exactly 5 multiple-choice questions for: ${topicNames}
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
Generate 1 active recall prompt for a student studying: ${topicNames}

The prompt should:
- Require the student to retrieve information from memory (not just recognize it)
- Target the single most important exam concept for this topic
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

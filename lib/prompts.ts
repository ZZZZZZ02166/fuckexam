export const PROMPTS = {
  perFileDecompose: (fileContent: string, fileName: string, examFormat: string) => `
You are a curriculum designer. Decompose this single lecture file into granular study stages for exam preparation.

File: ${fileName}
Exam format: ${examFormat}

Rules:
- Create one stage per distinct examinable concept cluster in this file
- A concept cluster deserves its own stage when a student could be tested on it independently
- Split concepts that are genuinely distinct — do NOT merge to reduce count
- Compression is wrong: if this file covers 8 separately testable topics, produce 8 stages
- Stage name: 3–6 words describing exactly what is NEW in that stage

Per stage:
- name: 3–6 words, precise, describes what is new
- key_concepts: 3–8 specific, precise, examinable concepts covered in this stage
- prerequisite_knowledge: specific concepts or topics a student MUST already understand before
  this stage makes sense. Be precise — e.g. "GDP definition and components", not "economics basics".
  Return an empty array only for genuinely foundational stages that assume zero prior knowledge.

File content:
${fileContent}
`.trim(),

  orderFiles: (fileDescriptions: string, subjectName: string) => `
You are ordering lecture files for "${subjectName}" from foundational to advanced.

Below are the lecture files with their first few stage topics listed.
Return them in the order a student should study them — foundational concepts first, applied/policy topics last.
Use the file names and stage topics as signals. If a file covers "introduction", "basics", or "fundamentals", it comes early.

${fileDescriptions}
`.trim(),

  enrichStages: (stageList: string, stageCount: number, subjectName: string, examFormat: string) => `
You are a curriculum designer enriching a study path for "${subjectName}" (exam: ${examFormat}).

Below are ${stageCount} study stages ALREADY IN CORRECT PEDAGOGICAL ORDER. Do not reorder them.

════════════════════════════════════════
STEP 1 — Extract topics (15–40 total)
════════════════════════════════════════
Topics are high-level mastery areas — broader than one stage, narrower than an entire lecture.
Group related key_concepts into topics. Multiple stages map to the same topic.
Expect 15–40 topics for a typical university course.
- name: 2–5 words, precise and distinct
- description: 1–2 sentences
- weight: 0.0–1.0 exam emphasis
- source_files: copy from stages that cover this topic

════════════════════════════════════════
STEP 2 — Fill in stage details (same order as input)
════════════════════════════════════════
For each stage, in the EXACT SAME ORDER as input:
- name: copy EXACTLY from input — do not rename
- topic_names: topic names from Step 1 (must exactly match Step 1 names)
- source_files: copy EXACTLY from input
- material_types: from ["summary", "flashcards", "concept_map"]
- test_types: always ["recall", "mcq"]
- estimated_minutes: 15–60 based on concept depth

CONSTRAINTS:
- Output exactly ${stageCount} stages in the EXACT SAME ORDER as input
- Do not reorder, merge, split, rename, add, or remove any stage

Stages (${stageCount} total — preserve this order exactly):
${stageList}
`.trim(),

  orderStages: (stagesJson: string, stageCount: number, subjectName: string, examFormat: string) => `
You are reviewing a proposed study path for "${subjectName}" (exam: ${examFormat}).

The ${stageCount} stages below are already in a tentative pedagogical order derived from the course's own lecture sequence and prerequisite analysis. Your job is to make MINIMAL, TARGETED improvements — only move a stage when it clearly violates an explicit prerequisite dependency.

WHEN TO MOVE A STAGE — only if ALL of these are true:
- The stage's prerequisite_knowledge explicitly requires knowledge that a LATER stage provides
- Moving it resolves the dependency without creating other violations
- The move is clearly necessary based on the content, not just domain convention

WHEN NOT TO MOVE A STAGE:
- Do not reorder based on your opinion of how this subject is typically taught in textbooks
- Do not move stages because you think "concept X usually precedes Y" in standard curricula
- Do not make large structural changes — the existing order reflects the course's own lecture sequence, which the instructor designed deliberately
- Stylistic or cosmetic reorderings are wrong. If in doubt, keep the original position.

VALID reasons to move (prerequisite_knowledge-driven only):
- A stage lists a concept in prerequisite_knowledge that only appears in a stage numbered later in the input
- Moving the prerequisite stage earlier resolves the gap

Return only JSON matching this schema: { ordered_stage_ids: string[] }
The array must contain the same IDs in the order a student should study them.
You MUST include every stage exactly once. Do NOT add, remove, rename, merge, or skip any stage.

Proposed order (make MINIMAL changes only):
${stagesJson}
`.trim(),

  buildSubject: (materialSample: string, examFormat: string, subjectName: string, lectureFileCount = 1) => `
You are a curriculum designer building a university exam study system.

Subject: ${subjectName}
Exam format: ${examFormat}
Lecture files: ${lectureFileCount} — each section labelled === FILE: filename === below.

Extract topics and build a complete study path.

Topics:
- name: 2–5 words, precise and distinct
- description: 1–2 sentences
- weight: 0.0–1.0 exam emphasis
- source_files: which files this came from

Stages:
- 1–3 tightly scoped NEW concepts per stage
- material_types: from ["summary", "flashcards", "concept_map"]
- test_types: always ["recall", "mcq"]
- estimated_minutes: 15–60 min
- source_files: which files informed this stage
- Every topic_name must match a topic name exactly

Material:
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

  generateConceptMapPlan: (stageName: string, topicNames: string, context: string, curriculumContext?: string) => `
You are planning a concept map for a stage titled: "${stageName}"
Stage topics: ${topicNames}
${curriculumContext ? `\nCurriculum context:\n${curriculumContext}\n` : ''}
CRITICAL — Root Selection Rule:
root.label MUST come from the stage title or stage topic names — it is the TOPIC BEING STUDIED, not what causes or enables it.
- Stage "Race Conditions" → root = "Race Conditions" (not "Shared Resources" which merely causes it)
- Stage "Critical Regions" → root = "Critical Region" or "Critical Regions"
- Stage "Mutex Implementation" → root = the primary mutex/locking concept
- Stage "Deadlock Prevention" → root = "Deadlock" (the problem being studied, not "Resource Allocation")
Do NOT choose a prerequisite, background concept, general container, or supporting mechanism as root.
The root is the chapter title of what the student is learning RIGHT NOW.

Return a structured plan:
- root: { label: must closely match stage title/topic, reason: one sentence justifying the choice }
- problemOrMotivation: 0–3 items — problems or motivations that explain WHY the root concept matters in this stage
- causesOrRequirements: 0–3 items — prerequisites or conditions that help explain or give context to the root
- methodsOrSolutions: 0–4 items — mechanisms, approaches, or algorithms that address or implement the root concept
- limitationsOrTraps: 0–3 items — drawbacks, risks, or exam traps related to the methods/solutions
- examples: 0–2 items — concrete examples, each with an "illustrates" field naming the SPECIFIC method or concept it demonstrates

Each item has { label: 2-5 words, detail: one sentence }.
If a category has no support in the source material, return an empty array.
Use ONLY the source material. Do not invent.

Source material:
${context}
`.trim(),

  generateConceptMap: (topicNames: string, context: string, curriculumContext?: string, plan?: {
    root: { label: string; reason: string }
    problemOrMotivation: Array<{ label: string; detail: string }>
    causesOrRequirements: Array<{ label: string; detail: string }>
    methodsOrSolutions: Array<{ label: string; detail: string }>
    limitationsOrTraps: Array<{ label: string; detail: string }>
    examples: Array<{ label: string; detail: string; illustrates: string }>
  }) => `
${plan ? `PLANNED STRUCTURE — follow this strictly when choosing nodes and relationships:
Root: ${plan.root.label}
${plan.problemOrMotivation.length ? `Problems/Motivation:\n${plan.problemOrMotivation.map(p => `  - ${p.label}: ${p.detail}`).join('\n')}` : 'Problems/Motivation: none'}
${plan.causesOrRequirements.length ? `Causes/Requirements:\n${plan.causesOrRequirements.map(c => `  - ${c.label}: ${c.detail}`).join('\n')}` : 'Causes/Requirements: none'}
${plan.methodsOrSolutions.length ? `Methods/Solutions:\n${plan.methodsOrSolutions.map(m => `  - ${m.label}: ${m.detail}`).join('\n')}` : 'Methods/Solutions: none'}
${plan.limitationsOrTraps.length ? `Limitations/Traps:\n${plan.limitationsOrTraps.map(l => `  - ${l.label}: ${l.detail}`).join('\n')}` : 'Limitations/Traps: none'}
${plan.examples.length ? `Examples:\n${plan.examples.map(e => `  - ${e.label}: ${e.detail} [illustrates: ${e.illustrates}]`).join('\n')}` : 'Examples: none'}

EDGE DIRECTION RULES — CRITICAL, DO NOT VIOLATE:
- The root "${plan.root.label}" MUST have ZERO incoming edges. Never write any relationship where the root's id appears as the "to" value.
- Causes/Requirements: write [root] → "requires" → [cause], NOT [cause] → "causes" → [root]
- Methods/Solutions: write [root] → "leads to" → [method], NOT [method] → "solves" → [root]
- Examples: connect via "exemplifies" ONLY to a specific child node of root, NEVER to root itself

Required teaching flow: root → problem/motivation → cause/requirement → method/solution → limitation/trap

` : ''}Generate a learning concept map strictly scoped to this stage's concepts.
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
- "solves": direction is always [solution/method node] → "solves" → [problem node]. Use when a method prevents or resolves a problem. EXCEPTION: if the root is the problem node, never use "solves" pointing into the root — express as root → "leads to" → [solution/method] instead.
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

  generateAnswerCoach: (topicNames: string, examFormat: string, context: string, curriculumContext?: string) => `
You are an expert university exam coach.

The student is studying: ${topicNames}
Exam format: ${examFormat}
${curriculumContext ? `\nCurriculum scope:\n${curriculumContext}\n` : ''}
Your task: create an Answer Coach section that teaches the student how to turn this stage into high-mark exam answers.

This is NOT a summary. This is NOT flashcards.
Focus on answer structure, marking criteria, weak vs strong answers, and common mistakes.

Generate 2–3 likely exam-style questions based on the source material.
For each question:
- question: realistic exam-style question that requires explanation, comparison, application, or reasoning — not just "what is X?"
- whyLikely: why this question could be assessed
- answerPlan: 4–6 ordered bullet points showing how to structure a full answer
- fullMarkAnswer: a strong, concise answer that would score highly in a university exam
- weakAnswer: a common incomplete or wrong answer a student might write
- whyWeak: exactly which marks are missing and why
- markingChecklist: 3–5 specific points an examiner would check for full marks
- commonMistake: one specific trap to avoid

Also produce examPhrases: 4–8 reusable academic phrases students can use in written answers on this topic.

Rules:
- Use ONLY the source material below.
- Focus on the current stage topic. The main question, answer plan, full-mark answer, and marking checklist must primarily assess this stage's concepts.
- Previous-stage concepts may be briefly referenced as assumed background when needed to make an answer complete, but must not be re-taught as the main focus.
- Future-stage concepts may be briefly mentioned if needed to complete an answer, but must not become the main tested idea, main marking checklist item, or main focus of the full-mark answer.
- Do not invent details not present in the source material.
- Keep tone clear, direct, and exam-focused.

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

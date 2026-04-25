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
You are an expert study path designer for university exam preparation.

Create an ordered study path from foundational to advanced stages.

Rules:
- Group 1-3 closely related topics per stage
- Order stages by dependency (prerequisites first), then exam weight
- Estimate realistic study time per stage (15-60 min)
- material_types: choose from ["summary", "flashcards", "concept_map"]
- test_types: always include ["recall", "mcq"]
- Align with the exam format (e.g., if problem-solving exam, weight later stages toward application)

Topics (JSON):
${topics}

Exam format described by student:
${examFormat}
`.trim(),

  generateSummary: (topicNames: string, examFormat: string, context: string) => `
Write a focused study summary for a university student preparing for: ${examFormat}

Topics to cover: ${topicNames}

Requirements:
- 350-500 words
- Bold key terms using **term** syntax
- Only include exam-relevant information
- Direct, clear language — not textbook prose

Source material (use only this):
${context}
`.trim(),

  generateFlashcards: (topicNames: string, examFormat: string, context: string) => `
Generate 8 flashcard Q&A pairs for a student studying: ${topicNames}
Exam type: ${examFormat}

For each card:
- front: a specific question that tests understanding (avoid "What is X?" — test application or relationships)
- back: a concise answer (1-3 sentences max)

Use only the provided source material.

Source material:
${context}
`.trim(),

  generateConceptMap: (topicNames: string, context: string) => `
Generate a text-based concept map showing relationships between concepts for: ${topicNames}

Format as a hierarchical tree. Show 2-3 levels max.
Use this exact format:
{
  "root": "main concept name",
  "tree": [
    {
      "label": "subtopic",
      "detail": "one-line explanation",
      "children": [
        { "label": "child concept", "detail": "explanation" }
      ]
    }
  ]
}

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

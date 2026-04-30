import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { getStageContext } from '@/lib/stageContext'
import { PROMPTS } from '@/lib/prompts'
import type { MaterialType, SummaryContent, FlashcardsContent, ConceptMapContent, AnswerCoachContent, Json } from '@/types/database'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const SummarySchema = z.object({
  quickOverview: z.array(z.string()),
  bigIdea: z.string(),
  mustKnow: z.array(z.string()),
  keyConcepts: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
    whyItMatters: z.string(),
  })),
  adaptiveSections: z.array(z.object({
    sectionType: z.string(),
    title: z.string(),
    purpose: z.string(),
    content: z.string(),
    items: z.array(z.string()).nullable(),
    examRelevance: z.string().nullable(),
    sourcePages: z.array(z.string()).nullable(),
  })),
  ideaConnections: z.array(z.object({
    from: z.string(),
    to: z.string(),
    relationship: z.string(),
  })),
  examTraps: z.array(z.object({
    trap: z.string(),
    correction: z.string(),
  })),
  quickCheck: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })),
  detailedNotes: z.string(),
})
const FlashcardsSchema = z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) })
const NODE_TYPES = ['concept', 'problem', 'solution', 'exam_trap', 'code_example',
  'process', 'definition', 'comparison', 'limitation', 'evidence', 'formula', 'example'] as const
const NODE_IMPORTANCE = ['primary', 'secondary', 'supporting'] as const
const RELATIONSHIP_LABELS = [
  'leads to', 'solves', 'causes', 'enables', 'contrasts with',
  'is part of', 'requires', 'produces', 'defines', 'exemplifies',
] as const
const ConceptMapSchema = z.object({
  title: z.string(),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    detail: z.string(),
    type: z.enum(NODE_TYPES),
    importance: z.enum(NODE_IMPORTANCE),
  })),
  relationships: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.enum(RELATIONSHIP_LABELS),
  })),
})
const AnswerCoachSchema = z.object({
  title: z.string().min(1),
  likelyQuestions: z.array(z.object({
    question: z.string().min(1),
    whyLikely: z.string().min(1),
    answerPlan: z.array(z.string()).min(4).max(6),
    fullMarkAnswer: z.string().min(1),
    weakAnswer: z.string().min(1),
    whyWeak: z.string().min(1),
    markingChecklist: z.array(z.string()).min(3).max(5),
    commonMistake: z.string().min(1),
  })).min(2).max(3),
  examPhrases: z.array(z.string()).min(4).max(8),
})

const ConceptMapPlanSchema = z.object({
  root: z.object({ label: z.string(), reason: z.string() }),
  problemOrMotivation: z.array(z.object({ label: z.string(), detail: z.string() })),
  causesOrRequirements: z.array(z.object({ label: z.string(), detail: z.string() })),
  methodsOrSolutions: z.array(z.object({ label: z.string(), detail: z.string() })),
  limitationsOrTraps: z.array(z.object({ label: z.string(), detail: z.string() })),
  examples: z.array(z.object({ label: z.string(), detail: z.string(), illustrates: z.string() })),
})
type ConceptMapPlan = z.infer<typeof ConceptMapPlanSchema>

function rootMatchesTopic(rootLabel: string, candidates: string[]): boolean {
  const rootLow = rootLabel.toLowerCase()
  const rootWords = new Set(rootLow.split(/\s+/).filter(w => w.length > 2))
  for (const c of candidates) {
    const cLow = c.toLowerCase()
    if (rootLow.includes(cLow) || cLow.includes(rootLow)) return true
    if (cLow.split(/\s+/).filter(w => w.length > 2).some(w => rootWords.has(w))) return true
  }
  return false
}

function summaryPassesQualityCheck(content: SummaryContent): boolean {
  return (
    (content.quickOverview?.length ?? 0) >= 3 &&
    (content.bigIdea?.trim().length ?? 0) >= 60 &&
    (content.keyConcepts?.length ?? 0) >= 3 &&
    (content.detailedNotes?.trim().length ?? 0) >= 100
  )
}

function answerCoachPassesQualityCheck(content: AnswerCoachContent): boolean {
  return (
    (content.likelyQuestions?.length ?? 0) >= 2 &&
    (content.examPhrases?.length ?? 0) >= 4 &&
    content.likelyQuestions.every(q =>
      q.question?.trim().length > 20 &&
      (q.answerPlan?.length ?? 0) >= 4 &&
      q.fullMarkAnswer?.trim().length > 80 &&
      q.weakAnswer?.trim().length > 10 &&
      q.whyWeak?.trim().length > 10 &&
      (q.markingChecklist?.length ?? 0) >= 3 &&
      q.commonMistake?.trim().length > 10
    )
  )
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: stage_id } = req.query as { id: string }
  const { type, force } = req.body as { type: MaterialType; force?: boolean }

  if (!['summary', 'flashcards', 'concept_map', 'answer_coach'].includes(type)) {
    return res.status(400).json({ error: 'type must be summary | flashcards | concept_map' })
  }

  const { data: stage } = await supabaseAdmin
    .from('study_stages')
    .select('*, subjects!inner(user_id, exam_format_text)')
    .eq('id', stage_id)
    .single()
  if (!stage || (stage as any).subjects.user_id !== user.id) {
    return res.status(404).json({ error: 'Stage not found' })
  }

  // Force regeneration: delete existing item + purpose-specific context cache
  if (force) {
    await supabaseAdmin
      .from('generated_items')
      .delete()
      .eq('stage_id', stage_id)
      .eq('type', type)

    const purposeMap: Record<string, string> = { concept_map: 'concept_map', answer_coach: 'answer_coach' }
    const cachePurpose = purposeMap[type] ?? 'general'
    await supabaseAdmin
      .from('stage_context_cache')
      .delete()
      .eq('stage_id', stage_id)
      .eq('purpose', cachePurpose)
  }

  // Check cache
  const { data: existing } = await supabaseAdmin
    .from('generated_items')
    .select('*')
    .eq('stage_id', stage_id)
    .eq('type', type)
    .single()
  if (existing) {
    console.log('[ai] content', type, 'cache_hit stage=', stage_id)
    return res.status(200).json(existing)
  }

  const { data: topics } = await supabaseAdmin
    .from('topics')
    .select('name')
    .in('id', stage.topic_ids ?? [])
  const topicNames = topics?.map(t => t.name).join(', ') ?? stage.name
  const examFormat = (stage as any).subjects.exam_format_text ?? 'university written exam'

  // Build full curriculum map for scope enforcement
  const { data: allStages } = await supabaseAdmin
    .from('study_stages')
    .select('id, name, stage_order, topic_ids')
    .eq('subject_id', stage.subject_id)
    .order('stage_order')

  const currentOrder: number = stage.stage_order
  const allTopicIds = [...new Set((allStages ?? []).flatMap((s: any) => s.topic_ids ?? []))]
  let allTopicMap = new Map<string, string>()
  if (allTopicIds.length > 0) {
    const { data: allTopics } = await supabaseAdmin.from('topics').select('id, name').in('id', allTopicIds)
    allTopicMap = new Map((allTopics ?? []).map((t: any) => [t.id, t.name]))
  }

  const previousTopicNames: string[] = []
  const futureTopicNames: string[] = []
  let curriculumContext = ''

  if ((allStages ?? []).length > 1) {
    const lines = (allStages ?? []).map((s: any) => {
      const stageTopicNames = (s.topic_ids ?? []).map((id: string) => allTopicMap.get(id)).filter(Boolean)
      if (s.stage_order < currentOrder) {
        stageTopicNames.forEach((n: string) => previousTopicNames.push(n))
        return `Stage ${s.stage_order} "${s.name}" [ALREADY COVERED]: ${stageTopicNames.join(', ')}`
      } else if (s.stage_order === currentOrder) {
        return `Stage ${s.stage_order} "${s.name}" [CURRENT STAGE]: ${stageTopicNames.join(', ')}`
      } else {
        stageTopicNames.forEach((n: string) => futureTopicNames.push(n))
        return `Stage ${s.stage_order} "${s.name}" [COVERED LATER]: ${stageTopicNames.join(', ')}`
      }
    })
    curriculumContext = lines.join('\n')
  }

  const purposeMap: Record<string, 'general' | 'concept_map' | 'answer_coach'> = {
    concept_map: 'concept_map',
    answer_coach: 'answer_coach',
  }
  const context = await getStageContext(
    stage_id,
    stage.subject_id,
    topics?.map(t => t.name) ?? [stage.name],
    previousTopicNames,
    futureTopicNames,
    purposeMap[type] ?? 'general',
    stage.name,
  )

  const forbiddenTerms = new Set(
    [...previousTopicNames, ...futureTopicNames].map(n => n.toLowerCase().trim())
  )
  function isAllowedConcept(term: string): boolean {
    if (!forbiddenTerms.size) return true
    const t = term.toLowerCase().trim()
    return ![...forbiddenTerms].some(f => t.includes(f) || f.includes(t))
  }

  let content: SummaryContent | FlashcardsContent | ConceptMapContent | AnswerCoachContent

  if (type === 'summary') {
    const forbiddenList = [...previousTopicNames, ...futureTopicNames].join(', ')
    const systemMsg = forbiddenList
      ? `You are a curriculum designer writing stage-specific study content. This stage covers ONLY: ${topicNames}. You must NOT define or create concept entries for any of the following — they are covered in other stages: ${forbiddenList}. If these appear in the source material, reference them only as forward/backward context in prose, never as key concept definitions.`
      : 'You are a curriculum designer. Write stage-specific study content for exactly the assigned topics.'
    const messages: Parameters<typeof openai.chat.completions.parse>[0]['messages'] = [
      { role: 'system', content: systemMsg },
      { role: 'user', content: PROMPTS.generateSummary(topicNames, examFormat, context, curriculumContext || undefined) },
    ]

    let parsed: SummaryContent | null = null

    try {
      console.log('[ai] content summary model=gpt-4o-mini stage=', stage_id)
      const r = await openai.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages,
        response_format: zodResponseFormat(SummarySchema, 'summary'),
      })
      const candidate = r.choices[0].message.parsed as SummaryContent
      if (!candidate || !summaryPassesQualityCheck(candidate)) throw new Error('quality_fail')
      parsed = candidate
    } catch {
      console.log('[ai] content summary fallback model=gpt-4o stage=', stage_id)
      const r = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages,
        response_format: zodResponseFormat(SummarySchema, 'summary'),
      })
      parsed = r.choices[0].message.parsed as SummaryContent
    }

    if (parsed && forbiddenTerms.size) {
      parsed.keyConcepts = (parsed.keyConcepts ?? []).filter(kc => isAllowedConcept(kc.term))
    }
    if (parsed) {
      parsed.masteryTerms = (parsed.keyConcepts ?? []).map(kc => kc.term)
    }
    content = parsed!

  } else if (type === 'flashcards') {
    console.log('[ai] content flashcards model=gpt-4o-mini stage=', stage_id)
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate stage-specific flashcards scoped strictly to the current stage\'s concepts. Never test concepts from other stages.' },
        { role: 'user', content: PROMPTS.generateFlashcards(topicNames, examFormat, context, curriculumContext || undefined) },
      ],
      response_format: zodResponseFormat(FlashcardsSchema, 'flashcards'),
    })
    content = r.choices[0].message.parsed as FlashcardsContent

  } else if (type === 'answer_coach') {
    const messages: Parameters<typeof openai.chat.completions.parse>[0]['messages'] = [
      {
        role: 'system',
        content: 'You are an expert university exam coach. Generate structured exam preparation content strictly grounded in the source material. Focus on answer structure, marking criteria, and common mistakes — not definitions or summaries.',
      },
      {
        role: 'user',
        content: PROMPTS.generateAnswerCoach(topicNames, examFormat, context, curriculumContext || undefined),
      },
    ]

    let parsed: AnswerCoachContent | null = null
    try {
      console.log('[ai] content answer_coach model=gpt-4o-mini stage=', stage_id)
      const r = await openai.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages,
        response_format: zodResponseFormat(AnswerCoachSchema, 'answer_coach'),
      })
      const candidate = r.choices[0].message.parsed as AnswerCoachContent
      if (!candidate || !answerCoachPassesQualityCheck(candidate)) throw new Error('quality_fail')
      parsed = candidate
    } catch {
      console.log('[ai] content answer_coach fallback model=gpt-4o stage=', stage_id)
      const r = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages,
        response_format: zodResponseFormat(AnswerCoachSchema, 'answer_coach'),
      })
      parsed = r.choices[0].message.parsed as AnswerCoachContent
    }

    content = parsed!

  } else {
    // concept_map — backend kept for DB compatibility, no longer used in UI
    const topicCandidates = [...(topics?.map(t => t.name) ?? []), stage.name]

    // Step 1: Generate a structured teaching plan to anchor the map to the stage topic
    console.log('[ai] concept_map plan_generating stage=', stage_id)
    let plan: ConceptMapPlan
    try {
      const planResult = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You produce structured concept map plans for teaching materials. Follow root selection rules exactly — the root MUST match the stage title or topic names.' },
          { role: 'user', content: PROMPTS.generateConceptMapPlan(stage.name, topicNames, context, curriculumContext || undefined) },
        ],
        response_format: zodResponseFormat(ConceptMapPlanSchema, 'concept_map_plan'),
      })
      plan = planResult.choices[0].message.parsed!
      if (!rootMatchesTopic(plan.root.label, topicCandidates)) {
        console.log('[ai] concept_map plan_root_overridden was=', plan.root.label, 'stage=', stage_id)
        plan = { ...plan, root: { label: topicNames, reason: 'Overridden: plan root did not match stage topic' } }
      } else {
        console.log('[ai] concept_map plan_root=', plan.root.label, 'stage=', stage_id)
      }
    } catch {
      // If plan generation fails, create a minimal fallback plan from topic names
      console.log('[ai] concept_map plan_failed_using_fallback stage=', stage_id)
      plan = { root: { label: topicNames, reason: 'Fallback plan' }, problemOrMotivation: [], causesOrRequirements: [], methodsOrSolutions: [], limitationsOrTraps: [], examples: [] }
    }

    // Step 2: Generate final concept map guided by the plan
    console.log('[ai] content concept_map model=gpt-4o stage=', stage_id)
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: [
            'You are a semantic concept-map builder. Your output must form a single connected directed acyclic graph with exactly one root.',
            '',
            'ROOT RULE: The root is already determined by the planning step — use the root from PLANNED STRUCTURE in the user message. Do not deviate from it.',
            '',
            'ABSOLUTE EDGE RULE: The root node MUST have ZERO incoming edges. Before returning, scan every relationship — if ANY relationship has the root node\'s id as the "to" value, remove it or reverse it into an outgoing edge from root. This is non-negotiable.',
            '',
            'EDGE DIRECTION FOR ROOT:',
            '- Causes/requirements branch OUT from root: root → "requires" → [cause]. NOT [cause] → "causes" → root.',
            '- Methods/solutions branch OUT from root: root → "leads to" → [method]. NOT [method] → "solves" → root.',
            '- Examples attach to specific child nodes: [example] → "exemplifies" → [child]. NEVER [example] → "exemplifies" → root.',
            '',
            'STRUCTURAL RULES:',
            '- The root MUST have importance="primary" and type="concept" or "problem". NEVER solution, process, example, or definition.',
            '- Every primary or secondary node that is NOT the root MUST appear as the "to" target in at least one relationship.',
            '- No disconnected clusters. EVERY node must be reachable from the root via the relationships chain.',
            '- No cycles. Relationships flow strictly from foundational → applied (DAG).',
            '- Exactly ONE node has no incoming edges (the root). All others have at least one incoming edge.',
            '- Relationships must encode real cause/effect, prerequisite, part-whole, or instantiation logic — not superficial association.',
            '- Exclude all concepts assigned to other stages.',
          ].join('\n'),
        },
        { role: 'user', content: PROMPTS.generateConceptMap(topicNames, context, curriculumContext || undefined, plan) },
      ],
      response_format: zodResponseFormat(ConceptMapSchema, 'concept_map'),
    })
    let mapData = r.choices[0].message.parsed!

    // Validate: BFS reachability + structural checks
    const adjMap = new Map<string, string[]>()
    const inDeg = new Map<string, number>()
    mapData.nodes.forEach(n => { adjMap.set(n.id, []); inDeg.set(n.id, 0) })
    mapData.relationships.forEach(rel => {
      adjMap.get(rel.from)?.push(rel.to)
      inDeg.set(rel.to, (inDeg.get(rel.to) ?? 0) + 1)
    })

    const rootCandidates = mapData.nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0)
    const trueRoot = rootCandidates.find(n => n.importance === 'primary') ?? rootCandidates[0]

    const reachable = new Set<string>()
    if (trueRoot) {
      const q = [trueRoot.id]
      while (q.length) {
        const id = q.shift()!
        if (reachable.has(id)) continue
        reachable.add(id)
        adjMap.get(id)?.forEach(child => q.push(child))
      }
    }

    const unreachable = mapData.nodes.filter(
      n => n.id !== trueRoot?.id &&
           (n.importance === 'primary' || n.importance === 'secondary') &&
           !reachable.has(n.id)
    )

    const badRootTypes = ['solution', 'process', 'example', 'definition', 'limitation', 'code_example']
    const rootIsWrongType = trueRoot && badRootTypes.includes(trueRoot.type)
    const multipleRoots = rootCandidates.length > 1
    const primaryNode = mapData.nodes.find(n => n.importance === 'primary')
    const primaryNotRoot = !!(primaryNode && trueRoot && primaryNode.id !== trueRoot.id && !reachable.has(primaryNode.id))
    const rootTopicMismatch = trueRoot ? !rootMatchesTopic(trueRoot.label, topicCandidates) : false

    if (unreachable.length === 0 && !rootIsWrongType && !multipleRoots && !primaryNotRoot && !rootTopicMismatch) {
      console.log('[ai] concept_map validation_passed stage=', stage_id)
    } else {
      const reasons = [
        ...unreachable.map(n => `${n.label}(${n.importance})`),
        ...(rootIsWrongType ? [`root_is_${trueRoot!.type}:${trueRoot!.label}`] : []),
        ...(multipleRoots ? [`multiple_roots(${rootCandidates.map(n => n.label).join('|')})`] : []),
        ...(primaryNotRoot ? [`primary_not_root:${primaryNode!.label}`] : []),
        ...(rootTopicMismatch ? [`root_topic_mismatch:${trueRoot!.label}`] : []),
      ].join(', ')
      console.log('[ai] concept_map repair_triggered reasons=', reasons, 'stage=', stage_id)

      const planSummary = [
        `Root: ${plan.root.label} (${plan.root.reason})`,
        plan.problemOrMotivation.length ? `Problems/Motivation: ${plan.problemOrMotivation.map(p => p.label).join(', ')}` : '',
        plan.causesOrRequirements.length ? `Causes/Requirements: ${plan.causesOrRequirements.map(c => c.label).join(', ')}` : '',
        plan.methodsOrSolutions.length ? `Methods/Solutions: ${plan.methodsOrSolutions.map(m => m.label).join(', ')}` : '',
        plan.limitationsOrTraps.length ? `Limitations/Traps: ${plan.limitationsOrTraps.map(l => l.label).join(', ')}` : '',
        plan.examples.length ? `Examples: ${plan.examples.map(e => `${e.label} (illustrates: ${e.illustrates})`).join(', ')}` : '',
      ].filter(Boolean).join('\n')

      try {
        const repairResult = await openai.chat.completions.parse({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a concept map expert. Restructure broken concept maps to match the intended teaching flow, with proper connectivity and correct root placement.',
            },
            {
              role: 'user',
              content: `This concept map is for a stage about: "${topicNames}".

INTENDED STRUCTURE FROM PLAN:
${planSummary}

ISSUES TO FIX:
${unreachable.length > 0 ? `- DISCONNECTED NODES (unreachable from root): ${unreachable.map(n => `"${n.label}" (id: ${n.id}, type: ${n.type}, importance: ${n.importance})`).join(', ')}. These MUST be integrated into the main flow.` : ''}
${rootIsWrongType ? `- WRONG ROOT TYPE: "${trueRoot!.label}" is typed as "${trueRoot!.type}" but roots MUST be concept or problem nodes.` : ''}
${multipleRoots ? `- MULTIPLE DISCONNECTED ROOTS: ${rootCandidates.map(n => `"${n.label}" (${n.type})`).join(', ')}. There must be EXACTLY ONE root.` : ''}
${primaryNotRoot ? `- PRIMARY NODE NOT IN FLOW: "${primaryNode!.label}" is primary importance but unreachable from root.` : ''}
${rootTopicMismatch ? `- ROOT TOPIC MISMATCH: root "${trueRoot!.label}" does not match stage topic "${topicNames}". Root must be "${plan.root.label}".` : ''}

RESTRUCTURING RULES:
1. Root must be "${plan.root.label}" — importance="primary", type="concept" or "problem".
2. Root has ZERO incoming edges. Scan every relationship: if root's id appears as "to", remove it or convert to an outgoing edge from root.
3. Causes/requirements: root → "requires" → [cause]. NOT [cause] → "causes" → root.
4. Methods/solutions: root → "leads to" → [method]. NOT [method] → "solves" → root.
5. Examples: [example] → "exemplifies" → [child node]. NEVER [example] → "exemplifies" → root.
6. Follow teaching flow: root → problem/motivation → cause/requirement → method/solution → limitation/trap.
7. EXACTLY ONE node with no incoming edges (the root). All others need at least one incoming edge.
8. No cycles. No disconnected clusters. Ground all connections in source material.
9. Return the COMPLETE corrected map with all nodes and relationships.

Source material:
${context}

Current broken map:
${JSON.stringify(mapData)}`,
            },
          ],
          response_format: zodResponseFormat(ConceptMapSchema, 'concept_map'),
        })

        const repaired = repairResult.choices[0].message.parsed
        if (repaired && repaired.nodes.length >= mapData.nodes.length) {
          // Re-run full BFS reachability check on the repaired map
          const repAdj = new Map<string, string[]>()
          const repInDeg = new Map<string, number>()
          repaired.nodes.forEach(n => { repAdj.set(n.id, []); repInDeg.set(n.id, 0) })
          repaired.relationships.forEach(rel => {
            repAdj.get(rel.from)?.push(rel.to)
            repInDeg.set(rel.to, (repInDeg.get(rel.to) ?? 0) + 1)
          })
          const repRootCandidates = repaired.nodes.filter(n => (repInDeg.get(n.id) ?? 0) === 0)
          const repRoot = repRootCandidates.find(n => n.importance === 'primary') ?? repRootCandidates[0]
          const repairedRootOk = repRoot && !badRootTypes.includes(repRoot.type)
          const repairedSingleRoot = repRootCandidates.length === 1
          const repPrimary = repaired.nodes.find(n => n.importance === 'primary')

          const repReachable = new Set<string>()
          if (repRoot) {
            const q = [repRoot.id]
            while (q.length) {
              const id = q.shift()!
              if (repReachable.has(id)) continue
              repReachable.add(id)
              repAdj.get(id)?.forEach(child => q.push(child))
            }
          }
          const stillUnreachable = unreachable.filter(n => !repReachable.has(n.id))
          const repPrimaryInFlow = !repPrimary || repRoot?.id === repPrimary.id || repReachable.has(repPrimary.id)
          const repRootMatchesTopic = repRoot ? rootMatchesTopic(repRoot.label, topicCandidates) : false

          if (stillUnreachable.length === 0 && repairedRootOk && repairedSingleRoot && repPrimaryInFlow && repRootMatchesTopic) {
            mapData = repaired
            console.log('[ai] concept_map repair_succeeded stage=', stage_id)
          } else {
            console.log('[ai] concept_map repair_failed still_unreachable=',
              stillUnreachable.map(n => n.label).join(', '),
              'root_ok=', repairedRootOk,
              'single_root=', repairedSingleRoot,
              'primary_in_flow=', repPrimaryInFlow,
              'root_matches_topic=', repRootMatchesTopic,
              'stage=', stage_id)
          }
        } else {
          console.log('[ai] concept_map repair_failed_node_count stage=', stage_id)
        }
      } catch {
        console.log('[ai] concept_map repair_error stage=', stage_id)
      }
    }

    content = mapData as ConceptMapContent
  }

  const { data: item, error } = await supabaseAdmin
    .from('generated_items')
    .insert({ stage_id, type, content: content as unknown as Json })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })

  if (stage.status === 'not_started') {
    await supabaseAdmin
      .from('study_stages')
      .update({ status: 'in_progress' })
      .eq('id', stage_id)
  }

  return res.status(201).json(item)
}

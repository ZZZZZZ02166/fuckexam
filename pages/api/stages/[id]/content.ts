import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { getStageContext } from '@/lib/stageContext'
import { PROMPTS } from '@/lib/prompts'
import type { MaterialType, SummaryContent, FlashcardsContent, ConceptMapContent, Json } from '@/types/database'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const SummarySchema = z.object({
  quickOverview: z.array(z.string()),
  bigIdea: z.string(),
  keyConcepts: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
    whyItMatters: z.string(),
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

function summaryPassesQualityCheck(content: SummaryContent): boolean {
  return (
    (content.quickOverview?.length ?? 0) >= 3 &&
    (content.bigIdea?.trim().length ?? 0) >= 60 &&
    (content.keyConcepts?.length ?? 0) >= 3 &&
    (content.detailedNotes?.trim().length ?? 0) >= 100
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

  if (!['summary', 'flashcards', 'concept_map'].includes(type)) {
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

    const cachePurpose = type === 'concept_map' ? 'concept_map' : 'general'
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

  const context = await getStageContext(
    stage_id,
    stage.subject_id,
    topics?.map(t => t.name) ?? [stage.name],
    previousTopicNames,
    futureTopicNames,
    type === 'concept_map' ? 'concept_map' : 'general',
  )

  const forbiddenTerms = new Set(
    [...previousTopicNames, ...futureTopicNames].map(n => n.toLowerCase().trim())
  )
  function isAllowedConcept(term: string): boolean {
    if (!forbiddenTerms.size) return true
    const t = term.toLowerCase().trim()
    return ![...forbiddenTerms].some(f => t.includes(f) || f.includes(t))
  }

  let content: SummaryContent | FlashcardsContent | ConceptMapContent

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

  } else {
    console.log('[ai] content concept_map model=gpt-4o stage=', stage_id)
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: [
            'You are a semantic concept-map builder. Your output must form a single connected directed acyclic graph with exactly one root.',
            '',
            'CRITICAL — ROOT SELECTION RULE:',
            `The root is the TOPIC BEING STUDIED in this stage — it is what the stage is ABOUT. The root node must directly match the stage topic: "${topicNames}".`,
            'Do NOT make a prerequisite or cause the root just because it has no prerequisites itself. The topic is the starting point for learning, not the starting point of causal chains.',
            'Example: For a stage about "Race Conditions", Race Conditions IS the root — not "Shared Resources" (which causes race conditions). Students are learning about race conditions; shared resources is assumed background.',
            'Example: For a stage about "Mutex Locks", Mutex Lock IS the root — race conditions (which motivated mutexes) belong to a previous stage.',
            '',
            'STRUCTURAL RULES:',
            `- The root MUST match "${topicNames}" in label or be the primary concept/problem node closest to that topic name.`,
            '- The root MUST have importance="primary" and type="concept" or "problem". NEVER solution, process, example, or definition.',
            '- Every primary or secondary node that is NOT the root MUST appear as the "to" target in at least one relationship.',
            '- No disconnected clusters. EVERY node must be reachable from the root via the relationships chain.',
            '- No cycles. Relationships flow strictly from foundational → applied (DAG).',
            '- Exactly ONE node has no incoming edges (the root). All others have at least one incoming edge.',
            '- Relationships must encode real cause/effect, prerequisite, part-whole, or instantiation logic — not superficial association.',
            '- Exclude all concepts assigned to other stages.',
          ].join('\n'),
        },
        { role: 'user', content: PROMPTS.generateConceptMap(topicNames, context, curriculumContext || undefined) },
      ],
      response_format: zodResponseFormat(ConceptMapSchema, 'concept_map'),
    })
    let mapData = r.choices[0].message.parsed!

    // Validate: build adjacency + indegree, then BFS from root to find unreachable important nodes
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

    if (unreachable.length === 0 && !rootIsWrongType && !multipleRoots && !primaryNotRoot) {
      console.log('[ai] concept_map validation_passed stage=', stage_id)
    } else {
      const reasons = [
        ...unreachable.map(n => `${n.label}(${n.importance})`),
        ...(rootIsWrongType ? [`root_is_${trueRoot!.type}:${trueRoot!.label}`] : []),
        ...(multipleRoots ? [`multiple_roots(${rootCandidates.map(n => n.label).join('|')})`] : []),
        ...(primaryNotRoot ? [`primary_not_root:${primaryNode!.label}`] : []),
      ].join(', ')
      console.log('[ai] concept_map repair_triggered reasons=', reasons, 'stage=', stage_id)

      try {
        const repairResult = await openai.chat.completions.parse({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a concept map expert. You restructure broken concept maps so they correctly represent the learning topic with proper node connectivity, flow direction, and root placement.',
            },
            {
              role: 'user',
              content: `This concept map is for a stage about: "${topicNames}".

ISSUES TO FIX:
${unreachable.length > 0 ? `- DISCONNECTED NODES (unreachable from root): ${unreachable.map(n => `"${n.label}" (id: ${n.id}, type: ${n.type}, importance: ${n.importance})`).join(', ')}. These MUST be integrated into the main flow.` : ''}
${rootIsWrongType ? `- WRONG ROOT TYPE: "${trueRoot!.label}" is typed as "${trueRoot!.type}" but roots MUST be concept or problem nodes.` : ''}
${multipleRoots ? `- MULTIPLE DISCONNECTED ROOTS: The map has ${rootCandidates.length} nodes with no incoming edges: ${rootCandidates.map(n => `"${n.label}" (${n.type})`).join(', ')}. This creates disconnected subgraphs. There must be EXACTLY ONE root — all other nodes must connect into the single root's reachability chain.` : ''}
${primaryNotRoot ? `- PRIMARY NODE NOT IN FLOW: "${primaryNode!.label}" (id: ${primaryNode!.id}) is marked as primary importance but is not reachable from the root. For a stage about "${topicNames}", the primary node should be at or near the root — it IS the main subject being studied.` : ''}

CRITICAL CONCEPT: The ROOT of a learning map is the TOPIC BEING STUDIED, not what causes it.
- For a stage about "Race Conditions": Race Conditions IS the root — students are learning what race conditions are and how they work. Shared resources is background context, not the starting node.
- For a stage about "Mutex Locks": Mutex Lock IS the root — students are learning about mutexes. Race conditions are what motivated mutexes, but they belong to a previous stage.
- Think of the root as the CHAPTER TITLE in a textbook. Everything else explains, exemplifies, or extends the chapter topic.

RESTRUCTURING RULES:
1. The root must have importance="primary" and type="concept" or "problem".
2. The PRIMARY node that matches "${topicNames}" must be the root OR must appear in level 1 directly reachable from the root.
3. PROBLEM nodes belong near the root. SOLUTION nodes appear downstream of problems. EXAMPLES and LIMITATIONS at the bottom.
4. EXACTLY ONE node must have no incoming edges (the root). Every other node must have at least one incoming edge.
5. No cycles. This is a directed acyclic graph — relationships flow from foundational → applied.
6. Do NOT invent connections — all relationships must be grounded in the source material.
7. Return the COMPLETE corrected map: all existing nodes (possibly re-typed or re-prioritized) plus all relationships.

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

          if (stillUnreachable.length === 0 && repairedRootOk && repairedSingleRoot && repPrimaryInFlow) {
            mapData = repaired
            console.log('[ai] concept_map repair_succeeded stage=', stage_id)
          } else {
            console.log('[ai] concept_map repair_failed still_unreachable=',
              stillUnreachable.map(n => n.label).join(', '),
              'root_ok=', repairedRootOk,
              'single_root=', repairedSingleRoot,
              'primary_in_flow=', repPrimaryInFlow,
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

import type { StudyStage, Topic, MasteryRecord, NextBestTask } from '@/types/database'

export function computeNextBestTask(
  stages: StudyStage[],
  topics: Topic[],
  masteryRecords: MasteryRecord[],
  examDate: string | null
): NextBestTask {
  const masteryMap = new Map(masteryRecords.map(m => [m.topic_id, m.level]))
  const daysUntil = examDate
    ? Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000)
    : null

  const sortedStages = [...stages].sort((a, b) => a.stage_order - b.stage_order)

  // Priority 1: continue current in-progress stage
  const inProgress = sortedStages.find(s => s.status === 'in_progress')
  if (inProgress) {
    return {
      type: 'continue_stage',
      stage_id: inProgress.id,
      stage_name: inProgress.name,
      reason: `Continue Stage ${inProgress.stage_order}: ${inProgress.name}`,
      estimated_minutes: inProgress.estimated_minutes ?? undefined,
    }
  }

  // Priority 2: repair red topics from completed stages
  const completedStageTopicIds = new Set(
    sortedStages
      .filter(s => s.status === 'complete' || s.status === 'needs_review')
      .flatMap(s => s.topic_ids ?? [])
  )
  const redTopicInCompleted = topics.find(
    t => completedStageTopicIds.has(t.id) && masteryMap.get(t.id) === 'red'
  )
  if (redTopicInCompleted) {
    const parentStage = sortedStages.find(s => (s.topic_ids ?? []).includes(redTopicInCompleted.id))
    return {
      type: 'repair_drill',
      stage_id: parentStage?.id,
      topic_id: redTopicInCompleted.id,
      stage_name: parentStage?.name,
      topic_name: redTopicInCompleted.name,
      reason: `${redTopicInCompleted.name} is weak — repair it before moving on`,
      estimated_minutes: 10,
    }
  }

  // Priority 3: start next unstarted stage
  const nextUnstarted = sortedStages.find(s => s.status === 'not_started')
  if (nextUnstarted) {
    return {
      type: 'start_stage',
      stage_id: nextUnstarted.id,
      stage_name: nextUnstarted.name,
      reason: `Start Stage ${nextUnstarted.stage_order}: ${nextUnstarted.name}`,
      estimated_minutes: nextUnstarted.estimated_minutes ?? undefined,
    }
  }

  // Priority 4: all stages done or exam close — review red/yellow
  const allDone = sortedStages.every(s => s.status === 'complete')
  const examClose = daysUntil !== null && daysUntil <= 7
  if (allDone || examClose) {
    const weakTopic = topics.find(
      t => masteryMap.get(t.id) === 'red' || masteryMap.get(t.id) === 'yellow'
    )
    if (weakTopic) {
      const parentStage = sortedStages.find(s => (s.topic_ids ?? []).includes(weakTopic.id))
      return {
        type: 'review_drill',
        stage_id: parentStage?.id,
        topic_id: weakTopic.id,
        topic_name: weakTopic.name,
        reason: examClose
          ? `Exam is in ${daysUntil} days — review your weakest topic`
          : `All stages complete — review ${weakTopic.name}`,
        estimated_minutes: 10,
      }
    }
  }

  return {
    type: 'complete',
    reason: 'All topics mastered — you\'re exam ready.',
  }
}

export function computeReadinessScore(
  topics: Topic[],
  masteryRecords: MasteryRecord[]
): number {
  const masteryMap = new Map(masteryRecords.map(m => [m.topic_id, m.level]))
  const attempted = topics.filter(t => {
    const level = masteryMap.get(t.id)
    return level && level !== 'grey'
  })
  if (attempted.length === 0) return 0
  const green = attempted.filter(t => masteryMap.get(t.id) === 'green')
  return Math.round((green.length / attempted.length) * 100)
}

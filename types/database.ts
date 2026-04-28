export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chunks: {
        Row: { content: string; embedding: string | null; id: string; material_id: string; material_type: string | null; metadata: Json | null }
        Insert: { content: string; embedding?: string | null; id?: string; material_id: string; material_type?: string | null; metadata?: Json | null }
        Update: { content?: string; embedding?: string | null; id?: string; material_id?: string; material_type?: string | null; metadata?: Json | null }
        Relationships: [{ foreignKeyName: "chunks_material_id_fkey"; columns: ["material_id"]; isOneToOne: false; referencedRelation: "materials"; referencedColumns: ["id"] }]
      }
      generated_items: {
        Row: { content: Json; created_at: string | null; id: string; stage_id: string; type: string }
        Insert: { content: Json; created_at?: string | null; id?: string; stage_id: string; type: string }
        Update: { content?: Json; created_at?: string | null; id?: string; stage_id?: string; type?: string }
        Relationships: [{ foreignKeyName: "generated_items_stage_id_fkey"; columns: ["stage_id"]; isOneToOne: false; referencedRelation: "study_stages"; referencedColumns: ["id"] }]
      }
      mastery_records: {
        Row: { id: string; level: string | null; score: number | null; topic_id: string; updated_at: string | null; user_id: string }
        Insert: { id?: string; level?: string | null; score?: number | null; topic_id: string; updated_at?: string | null; user_id: string }
        Update: { id?: string; level?: string | null; score?: number | null; topic_id?: string; updated_at?: string | null; user_id?: string }
        Relationships: [{ foreignKeyName: "mastery_records_topic_id_fkey"; columns: ["topic_id"]; isOneToOne: false; referencedRelation: "topics"; referencedColumns: ["id"] }]
      }
      materials: {
        Row: { created_at: string | null; file_name: string; id: string; material_type: string | null; processed_at: string | null; storage_path: string; subject_id: string }
        Insert: { created_at?: string | null; file_name: string; id?: string; material_type?: string | null; processed_at?: string | null; storage_path: string; subject_id: string }
        Update: { created_at?: string | null; file_name?: string; id?: string; material_type?: string | null; processed_at?: string | null; storage_path?: string; subject_id?: string }
        Relationships: [{ foreignKeyName: "materials_subject_id_fkey"; columns: ["subject_id"]; isOneToOne: false; referencedRelation: "subjects"; referencedColumns: ["id"] }]
      }
      questions: {
        Row: { content: Json; created_at: string | null; id: string; stage_id: string; topic_id: string | null; type: string }
        Insert: { content: Json; created_at?: string | null; id?: string; stage_id: string; topic_id?: string | null; type: string }
        Update: { content?: Json; created_at?: string | null; id?: string; stage_id?: string; topic_id?: string | null; type?: string }
        Relationships: [
          { foreignKeyName: "questions_stage_id_fkey"; columns: ["stage_id"]; isOneToOne: false; referencedRelation: "study_stages"; referencedColumns: ["id"] },
          { foreignKeyName: "questions_topic_id_fkey"; columns: ["topic_id"]; isOneToOne: false; referencedRelation: "topics"; referencedColumns: ["id"] }
        ]
      }
      readiness_snapshots: {
        Row: { computed_at: string | null; id: string; score: number | null; subject_id: string; user_id: string }
        Insert: { computed_at?: string | null; id?: string; score?: number | null; subject_id: string; user_id: string }
        Update: { computed_at?: string | null; id?: string; score?: number | null; subject_id?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "readiness_snapshots_subject_id_fkey"; columns: ["subject_id"]; isOneToOne: false; referencedRelation: "subjects"; referencedColumns: ["id"] }]
      }
      stage_context_cache: {
        Row: { context_text: string; created_at: string | null; id: string; purpose: string; stage_id: string }
        Insert: { context_text: string; created_at?: string | null; id?: string; purpose?: string; stage_id: string }
        Update: { context_text?: string; created_at?: string | null; id?: string; purpose?: string; stage_id?: string }
        Relationships: [{ foreignKeyName: "stage_context_cache_stage_id_fkey"; columns: ["stage_id"]; isOneToOne: false; referencedRelation: "study_stages"; referencedColumns: ["id"] }]
      }
      student_answers: {
        Row: { answer_hash: string | null; answer_text: string | null; answered_at: string | null; feedback: Json | null; id: string; question_id: string; score: string | null; user_id: string }
        Insert: { answer_hash?: string | null; answer_text?: string | null; answered_at?: string | null; feedback?: Json | null; id?: string; question_id: string; score?: string | null; user_id: string }
        Update: { answer_hash?: string | null; answer_text?: string | null; answered_at?: string | null; feedback?: Json | null; id?: string; question_id?: string; score?: string | null; user_id?: string }
        Relationships: [{ foreignKeyName: "student_answers_question_id_fkey"; columns: ["question_id"]; isOneToOne: false; referencedRelation: "questions"; referencedColumns: ["id"] }]
      }
      study_stages: {
        Row: { estimated_minutes: number | null; id: string; material_types: string[] | null; name: string; stage_order: number; status: string | null; subject_id: string; test_types: string[] | null; topic_ids: string[] | null }
        Insert: { estimated_minutes?: number | null; id?: string; material_types?: string[] | null; name: string; stage_order: number; status?: string | null; subject_id: string; test_types?: string[] | null; topic_ids?: string[] | null }
        Update: { estimated_minutes?: number | null; id?: string; material_types?: string[] | null; name?: string; stage_order?: number; status?: string | null; subject_id?: string; test_types?: string[] | null; topic_ids?: string[] | null }
        Relationships: [{ foreignKeyName: "study_stages_subject_id_fkey"; columns: ["subject_id"]; isOneToOne: false; referencedRelation: "subjects"; referencedColumns: ["id"] }]
      }
      subjects: {
        Row: { created_at: string | null; exam_date: string | null; exam_format_text: string | null; id: string; name: string; user_id: string }
        Insert: { created_at?: string | null; exam_date?: string | null; exam_format_text?: string | null; id?: string; name: string; user_id: string }
        Update: { created_at?: string | null; exam_date?: string | null; exam_format_text?: string | null; id?: string; name?: string; user_id?: string }
        Relationships: []
      }
      topics: {
        Row: { description: string | null; display_order: number | null; id: string; name: string; subject_id: string; weight: number | null }
        Insert: { description?: string | null; display_order?: number | null; id?: string; name: string; subject_id: string; weight?: number | null }
        Update: { description?: string | null; display_order?: number | null; id?: string; name?: string; subject_id?: string; weight?: number | null }
        Relationships: [{ foreignKeyName: "topics_subject_id_fkey"; columns: ["subject_id"]; isOneToOne: false; referencedRelation: "subjects"; referencedColumns: ["id"] }]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      match_chunks_for_stage:
        | {
            Args: { match_count?: number; query_embedding: string; stage_id_input: string }
            Returns: { content: string; id: string; metadata: Json; similarity: number }[]
          }
        | {
            Args: { match_count?: number; material_types_filter?: string[]; query_embedding: string; stage_id_input: string }
            Returns: { content: string; id: string; metadata: Json; similarity: number }[]
          }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

// ── App-level types ──────────────────────────────────────────────────────────

export type Subject = Database['public']['Tables']['subjects']['Row']
export type Material = Database['public']['Tables']['materials']['Row']
export type Chunk = Database['public']['Tables']['chunks']['Row']
export type Topic = Database['public']['Tables']['topics']['Row']
export type StudyStage = Database['public']['Tables']['study_stages']['Row']
export type GeneratedItem = Database['public']['Tables']['generated_items']['Row']
export type Question = Database['public']['Tables']['questions']['Row']
export type StudentAnswer = Database['public']['Tables']['student_answers']['Row']
export type MasteryRecord = Database['public']['Tables']['mastery_records']['Row']
export type ReadinessSnapshot = Database['public']['Tables']['readiness_snapshots']['Row']

export type StageStatus = 'not_started' | 'in_progress' | 'complete' | 'needs_review'
export type MaterialType = 'summary' | 'flashcards' | 'concept_map' | 'answer_coach'
export type TestType = 'recall' | 'mcq'
export type MasteryLevel = 'grey' | 'green' | 'yellow' | 'red'

export type UploadMaterialType =
  | 'course_lecture_material'
  | 'tutorial_material'
  | 'past_exam_questions'
  | 'exam_solutions_marking_guide'

export const UPLOAD_MATERIAL_TYPE_LABELS: Record<UploadMaterialType, string> = {
  course_lecture_material: 'Course lecture material',
  tutorial_material: 'Tutorial / problem set',
  past_exam_questions: 'Past exam questions',
  exam_solutions_marking_guide: 'Solutions / marking guide',
}

export interface SummaryContent {
  quickOverview: string[]
  bigIdea: string
  keyConcepts: Array<{ term: string; explanation: string; whyItMatters: string }>
  ideaConnections: Array<{ from: string; to: string; relationship: string }>
  examTraps: Array<{ trap: string; correction: string }>
  quickCheck: Array<{ question: string; answer: string }>
  detailedNotes: string
  masteryTerms?: string[]
}
export interface FlashcardsContent { cards: Array<{ front: string; back: string }> }
export type NodeType =
  'concept' | 'problem' | 'solution' | 'exam_trap' | 'code_example' |
  'process' | 'definition' | 'comparison' | 'limitation' | 'evidence' | 'formula' | 'example'
export type NodeImportance = 'primary' | 'secondary' | 'supporting'
export type RelationshipLabel =
  'leads to' | 'solves' | 'causes' | 'enables' | 'contrasts with' |
  'is part of' | 'requires' | 'produces' | 'defines' | 'exemplifies'
export interface ConceptMapNode { id: string; label: string; detail: string; type: NodeType; importance: NodeImportance }
export interface ConceptMapRelationship { from: string; to: string; label: RelationshipLabel }
export interface ConceptMapContent {
  title: string
  nodes: ConceptMapNode[]
  relationships: ConceptMapRelationship[]
}
export interface AnswerCoachContent {
  title: string
  likelyQuestions: Array<{
    question: string
    whyLikely: string
    answerPlan: string[]
    fullMarkAnswer: string
    weakAnswer: string
    whyWeak: string
    markingChecklist: string[]
    commonMistake: string
  }>
  examPhrases: string[]
}
export interface MCQContent { question: string; options: string[]; correct_index: number; explanation: string }
export interface RecallContent { prompt: string; ideal_answer: string; key_points: string[] }

export interface NextBestTask {
  type: 'continue_stage' | 'repair_drill' | 'start_stage' | 'review_drill' | 'complete'
  stage_id?: string
  topic_id?: string
  stage_name?: string
  topic_name?: string
  reason: string
  estimated_minutes?: number
}

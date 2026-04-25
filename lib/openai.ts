import OpenAI from 'openai'

// Server-only — never import this in page components
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

export async function vectorSearch(
  projectId: string,
  embedding: number[],
  topicNames: string[],
  limit = 8
): Promise<string[]> {
  // Returns chunk content strings for RAG context
  // Caller handles the DB query using supabaseAdmin
  return []
}

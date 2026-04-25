export interface TextChunk {
  content: string
  metadata: { chunk_index: number; heading?: string }
}

export function chunkText(text: string, chunkSize = 1800, overlap = 150): TextChunk[] {
  const chunks: TextChunk[] = []
  const lines = text.split('\n')
  let currentChunk = ''
  let currentHeading = ''
  let index = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Track heading context (all-caps lines or lines ending with :)
    if (trimmed.length < 80 && (trimmed === trimmed.toUpperCase() || trimmed.endsWith(':'))) {
      currentHeading = trimmed
    }

    if ((currentChunk + '\n' + trimmed).length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: { chunk_index: index++, heading: currentHeading || undefined },
      })
      // Start next chunk with overlap from end of previous
      const words = currentChunk.split(' ')
      currentChunk = words.slice(-Math.floor(overlap / 6)).join(' ') + '\n' + trimmed
    } else {
      currentChunk += (currentChunk ? '\n' : '') + trimmed
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: { chunk_index: index, heading: currentHeading || undefined },
    })
  }

  return chunks
}

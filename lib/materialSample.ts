export function buildMaterialSample(fullText: string, chunks: { content: string }[]): string {
  const parts: string[] = []

  parts.push(fullText.slice(0, 2000))

  const headingLines = fullText.split('\n')
    .filter(l => {
      const t = l.trim()
      return t.length > 3 && t.length < 80 &&
        (t === t.toUpperCase() || t.endsWith(':') || /^#{1,3}\s/.test(t))
    })
    .slice(0, 60)
  if (headingLines.length) parts.push(headingLines.join('\n'))

  const step = Math.max(1, Math.floor(chunks.length / 12))
  const excerpts = chunks
    .filter((_, i) => i % step === 0)
    .map(c => c.content.slice(0, 300))
  if (excerpts.length) parts.push(excerpts.join('\n\n'))

  parts.push(fullText.slice(-1000))

  return parts.join('\n\n---\n\n').slice(0, 10000)
}

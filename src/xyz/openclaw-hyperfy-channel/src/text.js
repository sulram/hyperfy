export function chunkText(text, maxLen = 500) {
  if (typeof text !== 'string') return []
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxLen) return [normalized]

  const chunks = []
  let remaining = normalized

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf(' ', maxLen)
    if (splitAt < Math.floor(maxLen * 0.6)) splitAt = maxLen
    const piece = remaining.slice(0, splitAt).trim()
    if (piece) chunks.push(piece)
    remaining = remaining.slice(splitAt).trimStart()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

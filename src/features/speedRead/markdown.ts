export function cleanMarkdown(markdown: string): string {
  let value = markdown.trim()
  value = value.replace(/^```(?:markdown|md)?\s*\n?/i, '')
  value = value.replace(/\n?```\s*$/i, '')
  return value.trim()
}

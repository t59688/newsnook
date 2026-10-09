import type { LinuxDoReaction } from '../types'

const REACTION_GLYPHS: Record<string, string> = {
  heart: '❤️',
  '+1': '👍',
  clap: '👏',
  laughing: '😆',
  open_mouth: '😮',
  tada: '🎉',
  thinking: '🤔',
  cry: '😢',
  angry: '😠',
}

export function reactionGlyph(id: string): string {
  return REACTION_GLYPHS[id] ?? '✨'
}

export function reactionTotal(reactions: LinuxDoReaction[]): number {
  return reactions.reduce((total, reaction) => total + Math.max(0, reaction.count), 0)
}

export function boostText(cooked: string): string {
  if (!cooked) return 'Boost'
  const document = new DOMParser().parseFromString('<!doctype html><html><body>' + cooked + '</body></html>', 'text/html')
  return document.body.textContent?.replace(/\s+/g, ' ').trim() || 'Boost'
}

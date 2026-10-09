export type ZhihuAnswerSwipeDirection = 'previous' | 'next'
export type ZhihuAnswerSwipeEdge = 'none' | 'start' | 'end' | 'both'

export const ANSWER_SWIPE_DIRECTION_LOCK_PX = 12
export const ANSWER_SWIPE_DIRECTION_BIAS = 1.15
export const ANSWER_SWIPE_COMMIT_RATIO = 0.22
export const ANSWER_SWIPE_MIN_COMMIT_PX = 120
export const ANSWER_SWIPE_MIN_GESTURE_MS = 90
export const ANSWER_SWIPE_FAST_COMMIT_RATIO = 0.38
export const ANSWER_SWIPE_WHEEL_SEQUENCE_GAP_MS = 180

const EDGE_EPSILON_PX = 1

export function answerSwipeStartEdge(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ZhihuAnswerSwipeEdge {
  const atStart = scrollTop <= EDGE_EPSILON_PX
  const atEnd = scrollHeight - scrollTop - clientHeight <= EDGE_EPSILON_PX
  if (atStart && atEnd) return 'both'
  if (atStart) return 'start'
  if (atEnd) return 'end'
  return 'none'
}

export function resolveAnswerSwipeDirection(
  edge: ZhihuAnswerSwipeEdge,
  deltaY: number,
): ZhihuAnswerSwipeDirection | null {
  if (deltaY > 0 && (edge === 'start' || edge === 'both')) return 'previous'
  if (deltaY < 0 && (edge === 'end' || edge === 'both')) return 'next'
  return null
}

export function answerSwipeCommitDistance(viewportHeight: number): number {
  return Math.max(ANSWER_SWIPE_MIN_COMMIT_PX, viewportHeight * ANSWER_SWIPE_COMMIT_RATIO)
}

export function shouldCommitAnswerSwipe(
  distance: number,
  viewportHeight: number,
  canGo: boolean,
  elapsedMs: number,
): boolean {
  return canGo
    && elapsedMs >= ANSWER_SWIPE_MIN_GESTURE_MS
    && Math.abs(distance) >= (elapsedMs < 240
      ? Math.max(answerSwipeCommitDistance(viewportHeight), viewportHeight * ANSWER_SWIPE_FAST_COMMIT_RATIO)
      : answerSwipeCommitDistance(viewportHeight))
}

export function canStartAnswerWheelSequence(
  edge: ZhihuAnswerSwipeEdge,
  direction: ZhihuAnswerSwipeDirection,
  elapsedSinceWheel: number,
): boolean {
  if (elapsedSinceWheel < ANSWER_SWIPE_WHEEL_SEQUENCE_GAP_MS) return false
  return direction === 'previous'
    ? edge === 'start' || edge === 'both'
    : edge === 'end' || edge === 'both'
}


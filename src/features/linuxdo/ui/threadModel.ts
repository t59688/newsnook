import type { LinuxDoPost, LinuxDoReplyTarget } from '../types'

type ReplySource = Pick<LinuxDoPost, 'postNumber' | 'username' | 'name' | 'avatarTemplate'>
type ReplyingPost = Pick<LinuxDoPost, 'replyToPostNumber' | 'replyToUser'>

export function resolveReplyTarget(
  post: ReplyingPost,
  posts: ReplySource[],
): LinuxDoReplyTarget | undefined {
  if (post.replyToUser) return post.replyToUser
  if (!post.replyToPostNumber) return undefined
  const target = posts.find((candidate) => candidate.postNumber === post.replyToPostNumber)
  if (!target) return undefined
  return {
    username: target.username,
    name: target.name,
    avatarTemplate: target.avatarTemplate,
  }
}

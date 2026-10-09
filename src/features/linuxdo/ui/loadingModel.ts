export type LinuxDoLoadingState = 'initial' | 'refreshing' | 'more' | 'idle'

export function linuxDoLoadingLabel(state: LinuxDoLoadingState): string {
  if (state === 'initial') return '正在加载主题'
  if (state === 'refreshing') return '正在刷新最新主题'
  if (state === 'more') return '正在加载更多内容'
  return ''
}

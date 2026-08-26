/**
 * 列表条目 id 的唯一生成规则。
 *
 * 分享短链（lib/shareLink）为了压缩长度会省掉 id，接收端必须算出同一个值，
 * 才能与本机列表里的同一篇对上已读、正文缓存与稍后读，所以这条规则单独成模块。
 */

/** djb2 变体：短且稳定，只用于本机去重，不作安全用途 */
export function hashId(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

/** 列表解析与分享短链共用：`<sourceId>:<链接哈希>` */
export function feedArticleId(sourceId: string, link: string): string {
  return `${sourceId}:${hashId(link)}`
}

/**
 * 从条目 id 反解信源 id。
 * 已读记录只存 id 集合，本地推荐按预设统计阅读量时靠它归属信源；
 * 不符合本模块规则的 id 返回空串（调用方按「无法归属」处理）。
 */
export function sourceIdOfArticleId(articleId: string): string {
  const separator = articleId.indexOf(':')
  return separator > 0 ? articleId.slice(0, separator) : ''
}

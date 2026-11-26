import { memo, useCallback, useEffect, useMemo } from 'react'

import { ArticleRow, LeadStory } from '../../components/ArticleItem'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import { dayBucket } from '../../lib/time'
import type { Article } from '../../lib/types'
import { DEFAULT_TRANSLATION_PREFS } from '../translation/config'
import { useFeedTranslation } from '../translation/useFeedTranslation'
import type { TranslationPrefs } from '../translation/types'
import type { HomeFeedLayout } from '../../sources/preferences'
import { hydrateWatchEventsFromCache, updateWatchArticlePreview, type WatchEvent } from './store'

interface Props {
  events: readonly WatchEvent[]
  layout: HomeFeedLayout
  readIds: ReadonlySet<string>
  savedIds: ReadonlySet<string>
  prestoredIds?: ReadonlySet<string>
  translationPrefs?: TranslationPrefs
  onOpen: (article: Article) => void
}

const EMPTY_IDS: ReadonlySet<string> = new Set()

/**
 * The global watch inbox uses the SAME ArticleRow and LeadStory components,
 * editorial wrappers, image recovery, and layout modes as the home feed.
 * Only the source collection (watched events) and unread state are different.
 */
export const WatchArticleFeed = memo(function WatchArticleFeed({
  events,
  layout,
  readIds,
  savedIds,
  prestoredIds = EMPTY_IDS,
  translationPrefs = DEFAULT_TRANSLATION_PREFS,
  onOpen,
}: Props) {
  const isDesktop = useIsDesktop()
  const useCompactCards = !isDesktop && layout === 'cards'
  const articles = useMemo(() => events.map(event => event.article), [events])
  const { translations } = useFeedTranslation(articles, translationPrefs, {
    enabled: translationPrefs.translateFeed !== false,
  })
  useEffect(() => {
    hydrateWatchEventsFromCache()
  }, [])
  const handleCoverResolved = useCallback((article: Article, imageUrl: string) => {
    updateWatchArticlePreview({ ...article, image: imageUrl }, { replaceImage: true })
  }, [])
  const lead = events.find(({ article }) => Boolean(article.image))
  const rest = useMemo(
    () => lead ? events.filter(event => event.key !== lead.key) : events,
    [events, lead],
  )

  // The inbox is organised by discovery time; the article component itself
  // still reports the publisher's real time, exactly like the home feed.
  const grouped = useMemo(() => {
    const byDay = new Map<string, WatchEvent[]>()
    for (const event of rest) {
      const bucket = dayBucket(event.discoveredAt)
      const items = byDay.get(bucket)
      if (items) items.push(event)
      else byDay.set(bucket, [event])
    }
    return [...byDay.entries()]
  }, [rest])

  const isRead = ({ article, read }: WatchEvent) => read || readIds.has(article.id)
  const sharedProps = ({ article }: WatchEvent) => ({
    article,
    saved: savedIds.has(article.id),
    prestored: prestoredIds.has(article.id),
    translated: translations.get(article.id),
    displayMode: translationPrefs.displayMode,
    onOpen,
    revealed: true,
  })
  const rowProps = (event: WatchEvent) => ({
    ...sharedProps(event),
    read: isRead(event),
    fallbackCover: true,
    recoverMissingCover: true,
    onCoverResolved: handleCoverResolved,
  })

  return (
    <div className="sw-feed-body editorial-feed-list w-full max-w-[2400px] mx-auto pb-12">
      {lead && (
        <LeadStory
          key={lead.key}
          {...sharedProps(lead)}
          read={isRead(lead)}
          framed={useCompactCards}
          variant={isDesktop ? 'banner' : 'lead'}
        />
      )}
      {useCompactCards ? (
        <ul className="editorial-mobile-card-grid grid grid-cols-1 items-start gap-2.5 px-3.5 py-2.5 min-[360px]:grid-cols-2 min-[430px]:gap-3 min-[430px]:px-4">
          {rest.map(event => (
            <ArticleRow
              key={event.key}
              {...rowProps(event)}
              variant="compact-card"
            />
          ))}
        </ul>
      ) : !isDesktop ? (
        grouped.map(([bucket, items]) => (
          <section className="editorial-feed-day-group" key={bucket}>
            <div className="editorial-feed-day page-x flex items-center gap-2.5 pt-5 pb-2 lg:px-6 xl:px-8 2xl:px-10">
              <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-paper-muted/90">{bucket}</span>
              <span className="h-px w-8 bg-gradient-to-r from-haze/80 to-transparent" aria-hidden="true" />
            </div>
            <ul className="editorial-feed-rows divide-y divide-haze/35">
              {items.map(event => (
                <ArticleRow
                  key={event.key}
                  {...rowProps(event)}
                  variant="row"
                />
              ))}
            </ul>
          </section>
        ))
      ) : layout === 'classic' ? (
        <div className="editorial-feed-timeline mx-auto w-full max-w-4xl px-4 py-2">
          {grouped.map(([bucket, items]) => (
            <section className="editorial-feed-day-group" key={bucket}>
              <div className="editorial-feed-day flex items-center gap-2.5 pt-5 pb-2">
                <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-paper-muted/90">{bucket}</span>
                <span className="h-px w-8 bg-gradient-to-r from-haze/80 to-transparent" aria-hidden="true" />
              </div>
              <ul className="editorial-feed-rows divide-y divide-haze/35">
                {items.map(event => (
                  <ArticleRow
                    key={event.key}
                    {...rowProps(event)}
                    variant="row"
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="editorial-desktop-card-grid grid grid-cols-2 gap-4 px-6 py-4 xl:grid-cols-3 2xl:grid-cols-4 min-[2100px]:grid-cols-5 xl:px-8 2xl:px-10 min-[2100px]:gap-5">
          {rest.map(event => (
            <ArticleRow
              key={event.key}
              {...rowProps(event)}
              variant="card"
            />
          ))}
        </ul>
      )}
    </div>
  )
})

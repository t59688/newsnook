import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ArrowLeft, Bell, Home, Loader2, ScrollText, Search, UserRound } from 'lucide-react'

import { HomeRefreshButton } from '../../../components/HomeRefreshButton'
import { PresetSwitcher, type PresetSwitcherProps } from '../../../components/PresetSwitcher'
import type { CloudTranslationConfig } from '../../translation/types'
import { ZhihuCollectionService } from '../collection/service'
import { ZhihuCommentDraftStore } from '../comments/draftStore'
import { ZhihuCommentsService } from '../comments/service'
import { ZhihuContentService } from '../content/service'
import { parseExistingAnswerId } from '../editor/codec'
import { ZhihuDraftStore } from '../editor/draftStore'
import { ZhihuEditorService } from '../editor/service'
import { ZhihuImageUploadService } from '../editor/upload'
import { clearZhihuSmartCandidatePool } from '../feed/candidatePool'
import { ZhihuRecommendationFeedbackService } from '../feed/feedback'
import { clearZhihuRecommendationProfile, type ZhihuRecommendationSignalItem } from '../feed/recommendation'
import { createZhihuFeedService } from '../feed/service'
import { useZhihuFeed } from '../feed/useZhihuFeed'
import { ZhihuInteractionService } from '../interaction/service'
import { createZhihuRootFrame, reduceRoutes, updateCurrentSearchState, zhihuRouteKey } from '../navigation'
import { ZhihuNotificationService } from '../notification/service'
import { ZhihuMessageDraftStore } from '../notification/draftStore'
import { ZhihuPeopleService } from '../people/service'
import { createZhihuRuntime } from '../runtime'
import { ZhihuTopicService } from '../topic/service'
import type {
  RouteFrame,
  ZhihuContentSummary,
  ZhihuEntityRef,
  ZhihuFeedMode,
  ZhihuSearchState,
} from '../types'
import type { ZhihuSessionSnapshot } from '../session/types'
import { ZhihuContentScreen, type ZhihuSpeedReadHeaderAction } from './ZhihuContentScreen'
import { ZhihuAccountCollectionsScreen } from './ZhihuAccountCollectionsScreen'
import { ZhihuCollectionScreen } from './ZhihuCollectionScreen'
import { ZhihuFeedScreen } from './ZhihuFeedScreen'
import { ZhihuEditorScreen } from './ZhihuEditorScreen'
import { ZhihuPeopleScreen } from './ZhihuPeopleScreen'
import { ZhihuSearchScreen } from './ZhihuSearchScreen'
import { ZhihuTopicScreen } from './ZhihuTopicScreen'
import { ZhihuAccountScreen } from './ZhihuAccountScreen'
import { ZhihuConversationScreen } from './ZhihuConversationScreen'
import { ZhihuNotificationScreen } from './ZhihuNotificationScreen'

interface Props {
  onExit: () => void
  backHandlerRef: MutableRefObject<(() => boolean) | null>
  presetSwitcher: PresetSwitcherProps
  fontScale: number
  onFontScale: (next: number) => void
  speedReadConfig: CloudTranslationConfig
}

let retainedFrames: RouteFrame[] | null = null
let retainedFeedScrolls: Partial<Record<ZhihuFeedMode, number>> = {}

interface FeedRouteProps {
  mode: ZhihuFeedMode
  feed: ReturnType<typeof useZhihuFeed>
  onModeChange: (mode: ZhihuFeedMode) => void
  onOpen: (item: ZhihuContentSummary) => void
  onImpression: (item: ZhihuContentSummary) => void
  onRecommendationFeedback: (
    item: ZhihuContentSummary,
    action: 'not-interested' | 'less-author',
  ) => void
  authenticated: boolean
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  homeRefreshRef: MutableRefObject<(() => void) | null>
}

/**
 * Feed 数据状态由 ZhihuWorkspace 持有；切到回答/搜索时这里只卸载视图，不卸载数据 hook。
 * 这样回到首页只恢复原列表与滚动位置，不会因为 FeedRoute 重新挂载而隐式刷新。
 */
function ZhihuFeedRoute({
  mode,
  feed,
  onModeChange,
  onOpen,
  onImpression,
  onRecommendationFeedback,
  authenticated,
  scrollContainerRef,
  homeRefreshRef,
}: FeedRouteProps) {
  const openItem = useCallback((item: ZhihuContentSummary) => {
    onOpen(item)
  }, [onOpen])
  return (
    <ZhihuFeedScreen
      mode={mode}
      items={feed.items}
      loading={feed.loading}
      loadingMore={feed.loadingMore}
      hasMore={feed.hasMore}
      error={feed.error}
      previews={feed.previews}
      authenticated={authenticated}
      scrollContainerRef={scrollContainerRef}
      onModeChange={onModeChange}
      onPrefetchMode={feed.prefetch}
      onRefresh={feed.refresh}
      onLoadMore={feed.loadMore}
      onOpen={openItem}
      onImpression={onImpression}
      onRecommendationFeedback={onRecommendationFeedback}
      homeRefreshRef={homeRefreshRef}
    />
  )
}

function capabilityPlaceholder(title: string, description: string) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center">
      <h2 className="font-display text-[22px] font-semibold text-paper">{title}</h2>
      <p className="mt-3 text-[13px] leading-7 text-paper-muted">{description}</p>
    </div>
  )
}

export function ZhihuWorkspace({ onExit, backHandlerRef, presetSwitcher, fontScale, onFontScale, speedReadConfig }: Props) {
  const runtime = useMemo(() => createZhihuRuntime(), [])
  const feedService = useMemo(() => createZhihuFeedService(runtime.api), [runtime])
  const recommendationFeedback = useMemo(
    () => new ZhihuRecommendationFeedbackService(runtime.api, runtime.session),
    [runtime],
  )
  const collectionService = useMemo(() => new ZhihuCollectionService(runtime.api), [runtime])
  const contentService = useMemo(() => new ZhihuContentService(runtime.api), [runtime])
  const commentsService = useMemo(() => new ZhihuCommentsService(runtime.api), [runtime])
  const commentDraftStore = useMemo(() => new ZhihuCommentDraftStore(), [])
  const peopleService = useMemo(() => new ZhihuPeopleService(runtime.api), [runtime])
  const topicService = useMemo(() => new ZhihuTopicService(runtime.api), [runtime])
  const interactionService = useMemo(() => new ZhihuInteractionService(runtime.api), [runtime])
  const notificationService = useMemo(() => new ZhihuNotificationService(runtime.api), [runtime])
  const messageDraftStore = useMemo(() => new ZhihuMessageDraftStore(), [])
  const draftStore = useMemo(() => new ZhihuDraftStore(), [])
  const editorService = useMemo(() => new ZhihuEditorService(runtime.api, draftStore), [draftStore, runtime])
  const imageUploadService = useMemo(() => new ZhihuImageUploadService(runtime.api, runtime.session), [runtime])
  const [sessionSnapshot, setSessionSnapshot] = useState<ZhihuSessionSnapshot>(() => runtime.session.getSnapshot())
  const [sessionHydrated, setSessionHydrated] = useState(false)
  const [sessionRestoreError, setSessionRestoreError] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [speedReadHeaderAction, setSpeedReadHeaderAction] = useState<ZhihuSpeedReadHeaderAction | null>(null)
  const [frames, setFrames] = useState<RouteFrame[]>(() => retainedFrames?.map((frame) => ({ ...frame })) ?? [createZhihuRootFrame()])
  const current = frames.at(-1) ?? createZhihuRootFrame()
  const currentRouteKey = zhihuRouteKey(current.route)
  const scrollRef = useRef<HTMLDivElement>(null)
  const feedHomeRefreshRef = useRef<(() => void) | null>(null)
  const answerPreviewHostRef = useRef<HTMLDivElement>(null)
  const contentOverlayCloserRef = useRef<(() => boolean) | null>(null)
  const feedPreviewRef = useRef(new Map<string, ZhihuContentSummary>())
  const rootFeedFrame = frames.find((frame) => frame.route.screen === 'feed')
  const homeFeedMode: ZhihuFeedMode = rootFeedFrame?.route.screen === 'feed'
    ? rootFeedFrame.route.mode
    : 'recommended'
  // Feed hook 固定在 workspace 生命周期内。回答页只是切换视图，不能把 feed hook 一起卸载，
  // 否则返回首页会再次触发 useZhihuFeed 的首屏请求，看起来像“无操作自动刷新”。
  const feedEnabled = sessionHydrated || homeFeedMode !== 'following'
  const feed = useZhihuFeed(
    feedService,
    homeFeedMode,
    'smart',
    sessionSnapshot.account?.id,
    feedEnabled,
  )

  useEffect(() => runtime.session.subscribe(setSessionSnapshot), [runtime])
  useEffect(() => () => recommendationFeedback.dispose(), [recommendationFeedback])
  useEffect(() => {
    let alive = true
    setSessionHydrated(false)
    setSessionRestoreError(null)
    void runtime.account.hydrate()
      .catch((cause) => {
        if (alive) setSessionRestoreError(cause instanceof Error ? cause.message : '知乎账号恢复失败')
      })
      .finally(() => {
        if (alive) setSessionHydrated(true)
      })
    return () => { alive = false }
  }, [runtime])

  useEffect(() => {
    retainedFrames = frames.map((frame) => ({ ...frame }))
  }, [frames])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    requestAnimationFrame(() => node.scrollTo({ top: current.scrollTop }))
  }, [current.scrollTop, currentRouteKey])

  const saveScroll = useCallback((source: RouteFrame[]) => {
    if (!source.length) return source
    const next = source.slice()
    const top = next.at(-1)!
    const scrollTop = scrollRef.current?.scrollTop ?? top.scrollTop
    next[next.length - 1] = { ...top, scrollTop }
    if (top.route.screen === 'feed') retainedFeedScrolls[top.route.mode] = scrollTop
    return next
  }, [])

  const pushEntity = useCallback((ref: ZhihuEntityRef, sourceAnchor?: string) => {
    setFrames((prev) => {
      const saved = saveScroll(prev)
      if (sourceAnchor && saved.length) {
        const index = saved.length - 1
        saved[index] = { ...saved[index], anchor: sourceAnchor }
      }
      return reduceRoutes(saved, { type: 'push', frame: { route: { screen: 'entity', ref }, scrollTop: 0 } })
    })
  }, [saveScroll])

  const pushEntityWithTargetAnchor = useCallback((ref: ZhihuEntityRef, targetAnchor?: string) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), {
      type: 'push',
      frame: {
        route: { screen: 'entity', ref },
        anchor: targetAnchor,
        scrollTop: 0,
      },
    }))
  }, [saveScroll])

  // 上/下一个回答属于同一阅读上下文：替换当前实体而不是继续叠 route。
  const replaceEntity = useCallback((ref: ZhihuEntityRef) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), {
      type: 'replace',
      frame: { route: { screen: 'entity', ref }, scrollTop: 0 },
    }))
  }, [saveScroll])

  const openFeedItem = useCallback((item: ZhihuContentSummary) => {
    recommendationFeedback.recordRead(sessionSnapshot.account?.id, item)
    feedPreviewRef.current.set(`${item.ref.kind}:${item.ref.id}`, item)
    pushEntity(item.ref)
  }, [pushEntity, recommendationFeedback, sessionSnapshot.account?.id])

  const recordFeedImpression = useCallback((item: ZhihuContentSummary) => {
    recommendationFeedback.recordImpression(sessionSnapshot.account?.id, item)
  }, [recommendationFeedback, sessionSnapshot.account?.id])

  const recordRecommendationSignal = useCallback((
    item: ZhihuRecommendationSignalItem,
    action: 'vote-up' | 'collect',
  ) => {
    recommendationFeedback.recordSignal(sessionSnapshot.account?.id, item, action)
  }, [recommendationFeedback, sessionSnapshot.account?.id])

  const recordFeedRecommendationFeedback = useCallback((
    item: ZhihuContentSummary,
    action: 'not-interested' | 'less-author',
  ) => {
    feed.dismiss(item)
    recommendationFeedback.recordSignal(sessionSnapshot.account?.id, item, action)
  }, [feed, recommendationFeedback, sessionSnapshot.account?.id])

  const resetSmartRecommendation = useCallback(async () => {
    const accountId = sessionSnapshot.account?.id
    clearZhihuRecommendationProfile(accountId)
    clearZhihuSmartCandidatePool()
    feedService.resetSmartRecommendation(accountId)
    await feed.refresh()
  }, [feed, feedService, sessionSnapshot.account?.id])

  const pushSearch = useCallback((
    query = '',
    restriction?: { memberHashId: string; memberName: string },
  ) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), {
      type: 'push',
      frame: {
        route: {
          screen: 'search',
          query,
          restrictedMemberHashId: restriction?.memberHashId,
          restrictedMemberName: restriction?.memberName,
        },
        scrollTop: 0,
      },
    }))
  }, [saveScroll])

  const updateSearchState = useCallback((state: ZhihuSearchState) => {
    setFrames((prev) => updateCurrentSearchState(prev, state))
  }, [])

  const openSearchResult = useCallback((ref: ZhihuEntityRef, state: ZhihuSearchState) => {
    setFrames((prev) => reduceRoutes(saveScroll(updateCurrentSearchState(prev, state)), {
      type: 'push',
      frame: { route: { screen: 'entity', ref }, scrollTop: 0 },
    }))
  }, [saveScroll])

  const goBack = useCallback(() => {
    if (frames.length <= 1) return false
    setFrames((prev) => reduceRoutes(prev, { type: 'back' }))
    return true
  }, [frames.length])

  const goHome = useCallback(() => {
    setFrames((prev) => {
      const saved = saveScroll(prev)
      const existingRoot = saved.find((frame) => frame.route.screen === 'feed')
      return [existingRoot ?? createZhihuRootFrame(homeFeedMode)]
    })
    return true
  }, [homeFeedMode, saveScroll])

  const refreshHomeFeed = useCallback(() => {
    retainedFeedScrolls[homeFeedMode] = 0
    setFrames((prev) => prev.map((frame) => frame.route.screen === 'feed' && frame.route.mode === homeFeedMode
      ? { ...frame, scrollTop: 0 }
      : frame))
    feedHomeRefreshRef.current?.()
  }, [homeFeedMode])

  const primaryRoute = current.route.screen === 'feed' || current.route.screen === 'notifications' || current.route.screen === 'profile'
  const handleWorkspaceBack = useCallback(() => {
    if (contentOverlayCloserRef.current?.()) return true
    // 上/下回答使用 replace，不制造回答历史；因此返回应忠实回到真正的来源页。
    return goBack()
  }, [goBack])

  useEffect(() => {
    backHandlerRef.current = handleWorkspaceBack
    return () => {
      if (backHandlerRef.current === handleWorkspaceBack) backHandlerRef.current = null
    }
  }, [backHandlerRef, handleWorkspaceBack])

  const setFeedMode = useCallback((mode: ZhihuFeedMode) => {
    if (mode === homeFeedMode) return
    setFrames((prev) => {
      saveScroll(prev)
      const next = createZhihuRootFrame(mode)
      next.scrollTop = retainedFeedScrolls[mode] ?? 0
      return [next]
    })
  }, [homeFeedMode, saveScroll])

  const openPrimaryRoute = useCallback((screen: 'notifications' | 'profile') => {
    setFrames((prev) => {
      const saved = saveScroll(prev)
      const root = saved.find((frame) => frame.route.screen === 'feed') ?? createZhihuRootFrame(homeFeedMode)
      return [root, { route: { screen }, scrollTop: 0 }]
    })
  }, [homeFeedMode, saveScroll])

  const navTo = useCallback((frame: RouteFrame) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), { type: 'push', frame }))
  }, [saveScroll])

  const openAnswerEditor = useCallback(async (questionId: string) => {
    const accountId = runtime.session.getSnapshot().account?.id
    if (!accountId) {
      navTo({ route: { screen: 'profile' }, scrollTop: 0 })
      return
    }
    setWorkspaceError(null)
    try {
      // 同一个问题优先恢复本机草稿，不能每点一次“写回答”就制造一个空副本。
      const existingLocal = (await draftStore.list(accountId)).find((item) => item.kind === 'answer' && item.targetId === questionId)
      if (existingLocal) {
        navTo({ route: { screen: 'editor', localDraftId: existingLocal.localDraftId }, scrollTop: 0 })
        return
      }

      const relationship = await runtime.api.getJson(
        'answer.relationship',
        `https://api.zhihu.com/questions/${encodeURIComponent(questionId)}?include=relationship,relationship.my_answer`,
      )
      const existingAnswerId = parseExistingAnswerId(relationship)
      let draft = await draftStore.create(accountId, 'answer', questionId)
      if (existingAnswerId) {
        // 已回答过的问题必须先把线上可编辑正文完整拉回本机再进入编辑器；禁止用空白草稿
        // 覆盖现有回答。editable_content 缺失时才退回 content。
        const existing = await contentService.read({ kind: 'answer', id: existingAnswerId })
        const html = existing.editableContentHtml ?? existing.contentHtml
        const text = typeof DOMParser !== 'undefined'
          ? new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
          : html.replace(/<[^>]+>/g, ' ')
        draft = await draftStore.save({
          ...draft,
          document: { version: 1, html, text },
          publishedContentId: existingAnswerId,
          publishState: 'published',
        })
      }
      navTo({ route: { screen: 'editor', localDraftId: draft.localDraftId }, scrollTop: 0 })
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : '无法打开回答编辑器')
    }
  }, [contentService, draftStore, navTo, runtime])

  const currentTitle = current.route.screen === 'feed'
    ? '知乎'
    : current.route.screen === 'search'
      ? '搜索'
      : current.route.screen === 'entity'
        ? ({
            question: '问题',
            answer: '回答',
            article: '文章',
            pin: '想法',
            people: '个人主页',
            topic: '话题',
            collection: '收藏夹',
            comment: '评论',
          } as const)[current.route.ref.kind] ?? '知乎'
        : current.route.screen === 'notifications'
          ? '消息'
          : current.route.screen === 'profile'
            ? '我的知乎'
            : current.route.screen === 'collections'
              ? '我的收藏夹'
            : current.route.screen === 'editor'
              ? '创作'
            : '知乎'

  const sessionCriticalRoute = current.route.screen === 'notifications'
    || current.route.screen === 'profile'
    || current.route.screen === 'collections'
    || current.route.screen === 'editor'
    || current.route.screen === 'conversation'
    || (current.route.screen === 'feed' && current.route.mode === 'following')

  const body = !sessionHydrated && sessionCriticalRoute ? (
    <div role="status" className="flex min-h-48 items-center justify-center font-mono text-[11px] text-paper-faint">正在恢复知乎会话…</div>
  ) : (() => {
    switch (current.route.screen) {
      case 'feed':
        return (
          <ZhihuFeedRoute
            mode={current.route.mode}
            feed={feed}
            onModeChange={setFeedMode}
            onOpen={openFeedItem}
            onImpression={recordFeedImpression}
            onRecommendationFeedback={recordFeedRecommendationFeedback}
            authenticated={sessionSnapshot.auth === 'authenticated'}
            scrollContainerRef={scrollRef}
            homeRefreshRef={feedHomeRefreshRef}
          />
        )
      case 'search':
        return (
          <ZhihuSearchScreen
            initialQuery={current.route.query}
            initialState={current.searchState}
            service={feedService}
            restrictedMemberHashId={current.route.restrictedMemberHashId}
            restrictedMemberName={current.route.restrictedMemberName}
            onQueryChange={(query, state) => setFrames((prev) => reduceRoutes(prev, {
              type: 'replace',
              frame: {
                route: {
                  screen: 'search',
                  query,
                  restrictedMemberHashId: current.route.screen === 'search' ? current.route.restrictedMemberHashId : undefined,
                  restrictedMemberName: current.route.screen === 'search' ? current.route.restrictedMemberName : undefined,
                },
                scrollTop: 0,
                searchState: state,
              },
            }))}
            onStateChange={updateSearchState}
            onClearRestriction={() => setFrames((prev) => reduceRoutes(prev, {
              type: 'replace', frame: { route: { screen: 'search', query: current.route.screen === 'search' ? current.route.query : '' }, scrollTop: 0 },
            }))}
            onOpen={openSearchResult}
            scrollContainerRef={scrollRef}
          />
        )
      case 'entity':
        if (current.route.ref.kind === 'people') {
          return (
            <ZhihuPeopleScreen
              token={current.route.ref.id}
              service={peopleService}
              onOpen={pushEntity}
              interaction={interactionService}
              authenticated={sessionSnapshot.auth === 'authenticated'}
              viewer={sessionSnapshot.account}
              onMessage={(peerId) => navTo({ route: { screen: 'conversation', peerId }, scrollTop: 0 })}
              onSearchCreations={(memberHashId, memberName) => pushSearch('', { memberHashId, memberName })}
            />
          )
        }
        if (current.route.ref.kind === 'topic') {
          return (
            <ZhihuTopicScreen
              topicId={current.route.ref.id}
              service={topicService}
              onOpen={pushEntity}
              interaction={interactionService}
              authenticated={sessionSnapshot.auth === 'authenticated'}
            />
          )
        }
        if (current.route.ref.kind === 'collection') {
          return (
            <ZhihuCollectionScreen
              collectionId={current.route.ref.id}
              service={collectionService}
              onOpen={pushEntity}
            />
          )
        }
        return (
          <ZhihuContentScreen
            refValue={current.route.ref}
            preview={feedPreviewRef.current.get(`${current.route.ref.kind}:${current.route.ref.id}`)}
            contentService={contentService}
            feedService={feedService}
            commentsService={commentsService}
            onNavigate={pushEntity}
            onReplaceNavigate={replaceEntity}
            overlayCloserRef={contentOverlayCloserRef}
            restoreAnchor={current.anchor}
            authenticated={sessionSnapshot.auth === 'authenticated'}
            accountId={sessionSnapshot.account?.id}
            commentDraftStore={commentDraftStore}
            interaction={interactionService}
            onRecommendationSignal={recordRecommendationSignal}
            onWriteAnswer={(questionId) => void openAnswerEditor(questionId)}
            scrollContainerRef={scrollRef}
            answerPreviewHostRef={answerPreviewHostRef}
            fontScale={fontScale}
            onFontScale={onFontScale}
            speedReadConfig={speedReadConfig}
            onSpeedReadHeaderActionChange={setSpeedReadHeaderAction}
          />
        )
      case 'notifications':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuNotificationScreen
            service={notificationService}
            onOpen={pushEntityWithTargetAnchor}
            onMessage={(peerId) => navTo({ route: { screen: 'conversation', peerId }, scrollTop: 0 })}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看评论、赞同、关注通知和私信。')
      case 'profile':
        return (
          <ZhihuAccountScreen
            runtime={runtime}
            onOpenEditor={() => navTo({ route: { screen: 'editor', localDraftId: 'new' }, scrollTop: 0 })}
            onOpenProfile={(urlToken) => pushEntity({ kind: 'people', id: urlToken })}
            onOpenCollections={(urlToken) => navTo({ route: { screen: 'collections', urlToken }, scrollTop: 0 })}
            onResetRecommendation={resetSmartRecommendation}
          />
        )
      case 'collections':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuAccountCollectionsScreen
            urlToken={current.route.urlToken}
            service={interactionService}
            onOpenCollection={(collectionId) => pushEntity({ kind: 'collection', id: collectionId })}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看和管理你的知乎收藏夹。')
      case 'editor':
        return sessionSnapshot.auth === 'authenticated' && sessionSnapshot.account ? (
          <ZhihuEditorScreen
            accountId={sessionSnapshot.account.id}
            localDraftId={current.route.localDraftId}
            store={draftStore}
            service={editorService}
            uploadService={imageUploadService}
            onOpenDraft={(localDraftId) => navTo({ route: { screen: 'editor', localDraftId }, scrollTop: 0 })}
            onPublished={pushEntity}
            onDeleted={() => { if (!goBack()) navTo({ route: { screen: 'editor', localDraftId: 'new' }, scrollTop: 0 }) }}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可进入草稿箱、写回答、发布想法和上传图片。')
      case 'conversation':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuConversationScreen
            peerId={current.route.peerId}
            accountId={sessionSnapshot.account?.id}
            service={notificationService}
            draftStore={messageDraftStore}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看知乎私信会话。')
    }
  })()

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col bg-ink" aria-label="知乎工作区">
      {/* AppShell 已经统一吃掉顶部 safe-area；工作区再次加 --sat 会在打孔/刘海机型上形成双倍顶部留白。 */}
      <header className={`relative z-20 flex shrink-0 items-center gap-2.5 border-b border-haze/45 bg-ink/94 px-3 backdrop-blur-xl sm:px-5 ${primaryRoute ? 'min-h-[56px]' : 'min-h-[50px]'}`}>
        <button
          type="button"
          onClick={() => (handleWorkspaceBack() ? undefined : onExit())}
          aria-label={frames.length > 1 ? '返回上一页' : '返回 NewsNook'}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-paper-muted/80 transition-colors hover:bg-paper/5 hover:text-sky-500 active:scale-95"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>

        {current.route.screen === 'feed' ? (
          <button
            type="button"
            onClick={() => pushSearch('')}
            aria-label="搜索知乎内容、问题、答主"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-haze/60 bg-ink-raised/40 px-3.5 text-[13px] text-paper-faint transition-[border-color,background-color,color,transform] hover:border-sky-500/40 hover:bg-ink-raised/75 hover:text-paper active:scale-[0.99]"
          >
            <Search size={14} strokeWidth={2} className="shrink-0 text-sky-500" />
            <span className="truncate">搜索知乎内容、问题、答主…</span>
          </button>
        ) : (
          <div className="min-w-0 flex-1 truncate font-sans text-[16px] font-semibold tracking-tight text-paper">{currentTitle}</div>
        )}

        {speedReadHeaderAction && (
          <button
            type="button"
            onClick={speedReadHeaderAction.onOpen}
            aria-expanded={speedReadHeaderAction.open}
            aria-label={speedReadHeaderAction.state === 'loading' ? '当前内容正在生成 AI 速读' : '打开当前内容的 AI 速读'}
            className={`group flex h-8.5 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-[border-color,background-color,color,transform] active:scale-[0.97] ${speedReadHeaderAction.open || speedReadHeaderAction.state === 'ready' ? 'border-sky-500/40 bg-sky-500/10 text-sky-500' : 'border-haze/75 bg-ink-raised/45 text-paper-muted hover:border-sky-500/35 hover:text-paper'}`}
          >
            {speedReadHeaderAction.state === 'loading'
              ? <Loader2 size={13} className="animate-spin" />
              : <ScrollText size={13} strokeWidth={1.7} />}
            <span>AI 速读</span>
            {speedReadHeaderAction.state === 'ready' && <span className="size-1 rounded-full bg-sky-500" aria-hidden />}
          </button>
        )}
        {primaryRoute && <PresetSwitcher {...presetSwitcher} />}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={answerPreviewHostRef} className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ink" aria-hidden />
        <div ref={scrollRef} className="reader-font-pinch-surface scroll-hidden relative z-10 h-full overflow-y-auto overscroll-contain bg-ink">
          {sessionRestoreError && (
            <div role="alert" className="mx-4 mt-3 rounded-xl border border-cinnabar/35 bg-cinnabar/5 px-3 py-2.5 text-[12px] leading-5 text-paper-muted sm:mx-6">
              账号恢复失败：{sessionRestoreError}。已保留本机数据，请到“我的”重试验证。
            </div>
          )}
          {workspaceError && (
            <div role="alert" className="mx-4 mt-3 rounded-xl border border-cinnabar/35 bg-cinnabar/5 px-3 py-2.5 text-[12px] leading-5 text-paper-muted sm:mx-6">
              {workspaceError}
            </div>
          )}
          {body}
        </div>
      </div>

      {primaryRoute && (
      <nav className="absolute inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-haze/45 bg-ink/94 backdrop-blur-xl" style={{ paddingBottom: 'max(var(--sab), 0.35rem)' }} aria-label="知乎主导航">
        <HomeRefreshButton
          active={current.route.screen === 'feed'}
          refreshing={feed.loading}
          onNavigateHome={goHome}
          onRefresh={refreshHomeFeed}
          className={`group flex min-h-13 flex-col items-center justify-center gap-0.5 font-sans text-[11px] transition-[color,transform] active:scale-[0.96] ${current.route.screen === 'feed' ? 'font-semibold text-[#0066FF] dark:text-[#3B82F6]' : 'text-paper-muted/75 hover:text-paper'}`}
          aria-label="首页"
        >
          <Home size={19} strokeWidth={current.route.screen === 'feed' ? 2.2 : 1.6} className={current.route.screen === 'feed' ? 'scale-105' : ''} /><span>首页</span>
        </HomeRefreshButton>
        <button
          type="button"
          onClick={() => openPrimaryRoute('notifications')}
          className={`group flex min-h-13 flex-col items-center justify-center gap-0.5 font-sans text-[11px] transition-[color,transform] active:scale-[0.96] ${current.route.screen === 'notifications' ? 'font-semibold text-[#0066FF] dark:text-[#3B82F6]' : 'text-paper-muted/75 hover:text-paper'}`}
        >
          <Bell size={19} strokeWidth={current.route.screen === 'notifications' ? 2.2 : 1.6} className={current.route.screen === 'notifications' ? 'scale-105' : ''} /><span>消息</span>
        </button>
        <button
          type="button"
          onClick={() => openPrimaryRoute('profile')}
          className={`group flex min-h-13 flex-col items-center justify-center gap-0.5 font-sans text-[11px] transition-[color,transform] active:scale-[0.96] ${current.route.screen === 'profile' ? 'font-semibold text-[#0066FF] dark:text-[#3B82F6]' : 'text-paper-muted/75 hover:text-paper'}`}
        >
          <UserRound size={19} strokeWidth={current.route.screen === 'profile' ? 2.2 : 1.6} className={current.route.screen === 'profile' ? 'scale-105' : ''} /><span>我的</span>
        </button>
      </nav>
      )}
    </section>
  )
}

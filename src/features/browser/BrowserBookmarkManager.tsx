import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Bookmark, Check, CheckSquare, ChevronRight, Folder, FolderInput,
  FolderPlus, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Trash2, X,
} from 'lucide-react'
import {
  BrowserEmptyState, BrowserIconButton, BrowserPageHeader, BrowserSheet, BrowserSiteIcon, BrowserStatusBanner,
} from './BrowserPrimitives'
import { advancePrivateBookmarkTap, EMPTY_PRIVATE_BOOKMARK_TAP, type BookmarkScope, type PrivateBookmarkTap } from './browserBookmarks'
import {
  addBookmark, bookmarkFolderDescendants, bookmarkFolderOptions, bookmarkFolderPath, createBookmarkFolder,
  deleteBookmarkFolder, deleteBookmarks, editBookmark, moveBookmarkFolder, moveBookmarks,
  newBookmarkFolderId, renameBookmarkFolder, type BrowserBookmark, type BrowserBookmarkFolder,
  type BrowserBookmarkLibrary,
} from './browserBookmarkLibrary'

type Confirm = {title:string; message:string; actionLabel?:string; confirm:()=>boolean; successMessage?:string}
type Dialog =
  | {type:'new-folder'}
  | {type:'rename-folder'; id:string}
  | {type:'move-folder'; id:string}
  | {type:'new-bookmark'}
  | {type:'edit-bookmark'; url:string}
  | {type:'move-bookmarks'; urls:string[]}
  | {type:'folder-actions'; id:string}
  | {type:'bookmark-actions'; url:string}

interface Props {
  normal: BrowserBookmarkLibrary
  privateLibrary: BrowserBookmarkLibrary
  privateMode: boolean
  onBack: () => void
  onOpen: (url:string) => void
  onChange: (scope:BookmarkScope, next:BrowserBookmarkLibrary) => boolean
  onClear: (scope:BookmarkScope) => void
  onConfirm: (config:Confirm) => void
  onRegisterBack?: (handler: () => boolean) => void
}

interface CollectionProps {
  scope: BookmarkScope
  library: BrowserBookmarkLibrary
  privateMode: boolean
  query: string
  onOpen: (url:string) => void
  onChange: (scope:BookmarkScope, next:BrowserBookmarkLibrary) => boolean
  onClear: (scope:BookmarkScope) => void
  onConfirm: (config:Confirm) => void
  registerBack: (handler:()=>boolean) => void
}
function containsQuery(bookmark: BrowserBookmark, query: string): boolean {
  return bookmark.title.toLocaleLowerCase().includes(query) || bookmark.url.toLocaleLowerCase().includes(query)
}
function folderCount(library: BrowserBookmarkLibrary): Map<string,number> {
  const folderMap = new Map(library.folders.map(item => [item.id, item]))
  const counts = new Map<string, number>()
  for (const bookmark of library.bookmarks) {
    const visited = new Set<string>()
    let id = bookmark.folderId
    while (id && folderMap.has(id) && !visited.has(id)) {
      visited.add(id)
      counts.set(id,(counts.get(id) ?? 0)+1)
      id = folderMap.get(id)!.parentId
    }
  }
  return counts
}
function BookmarkCollection({
  scope, library, privateMode, query, onOpen, onChange, onClear, onConfirm, registerBack,
}: CollectionProps) {
  const isPrivate = scope === 'private'
  const [folderId, setFolderId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [formError, setFormError] = useState('')
  const currentFolder = folderId && library.folders.some(folder => folder.id === folderId) ? folderId : null
  const hasQuery = query.length > 0
  const folderById = useMemo(() => new Map(library.folders.map(folder => [folder.id,folder])), [library.folders])
  const counts = useMemo(() => folderCount(library), [library])
  const visibleFolders = useMemo(() => library.folders.filter(folder => hasQuery
    ? folder.name.toLocaleLowerCase().includes(query) : folder.parentId === currentFolder)
    .sort((a,b) => a.name.localeCompare(b.name,'zh-CN')), [library.folders, hasQuery, query, currentFolder])
  const visibleBookmarks = useMemo(() => library.bookmarks.filter(bookmark => hasQuery
    ? containsQuery(bookmark,query) : bookmark.folderId === currentFolder), [library.bookmarks,hasQuery,query,currentFolder])
  const path = bookmarkFolderPath(library,currentFolder)
  const selectedSet = useMemo(() => new Set(selected), [selected])

  useEffect(() => { setSelected([]); setSelecting(false) }, [query, currentFolder])
  useEffect(() => {
    const handleKey = (event:KeyboardEvent) => {
      if (event.key !== 'Escape' || !dialog) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setDialog(null)
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [dialog])
  useEffect(() => {
    registerBack(() => {
      if (dialog) {setDialog(null); return true}
      if (selecting) {setSelecting(false);setSelected([]);return true}
      if (currentFolder) {setFolderId(folderById.get(currentFolder)?.parentId ?? null);return true}
      return false
    })
    return () => registerBack(() => false)
  }, [dialog, selecting, currentFolder, folderById, registerBack])

  const openDialog = (next:Dialog) => {
    setFormError('')
    setDialog(next)
    if (next.type === 'rename-folder' || next.type === 'folder-actions') {
      setName(folderById.get(next.id)?.name ?? '')
      setAddress('')
    } else if (next.type === 'edit-bookmark' || next.type === 'bookmark-actions') {
      const bookmark = library.bookmarks.find(item => item.url === next.url)
      setName(bookmark?.title ?? '')
      setAddress(bookmark?.url ?? '')
    } else {
      setName('')
      setAddress('')
    }
  }

  const commit = (next: BrowserBookmarkLibrary, after?:()=>void) => {
    if (onChange(scope, next)) {
      setDialog(null)
      setFormError('')
      after?.()
    } else setFormError('保存失败，请重试')
  }
  const submit = (event:FormEvent) => {
    event.preventDefault()
    if (!dialog) return
    try {
      if (dialog.type === 'new-folder') {
        commit(createBookmarkFolder(library,name,currentFolder,newBookmarkFolderId()))
      } else if (dialog.type === 'rename-folder') {
        commit(renameBookmarkFolder(library,dialog.id,name))
      } else if (dialog.type === 'new-bookmark') {
        const url = /^(https?:\/\/)/i.test(address.trim()) ? address.trim() : 'https://' + address.trim()
        commit(addBookmark(library,name,url,currentFolder))
      } else if (dialog.type === 'edit-bookmark') {
        const url = /^(https?:\/\/)/i.test(address.trim()) ? address.trim() : 'https://' + address.trim()
        commit(editBookmark(library,dialog.url,name,url))
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '操作失败')
    }
  }
  const askDeleteBookmark = (urls: string[]) => onConfirm({
    title: urls.length === 1 ? '删除书签' : '批量删除书签',
    message: `确定删除选中的 ${urls.length} 个书签？删除后不可恢复。`,
    actionLabel: '确认删除',
    confirm: () => {
      const ok = onChange(scope, deleteBookmarks(library,urls))
      if (ok) {setSelected([]);setSelecting(false);setDialog(null)}
      return ok
    },
  })
  const askDeleteFolder = (folder:BrowserBookmarkFolder) => {
    const descendants = bookmarkFolderDescendants(library,folder.id)
    const included = library.bookmarks.filter(bookmark => !!bookmark.folderId && descendants.has(bookmark.folderId)).length
    onConfirm({
      title: '删除文件夹',
      message: `将删除「${folder.name}」及所有子文件夹，同时删除其中 ${included} 个书签。此操作不可恢复。`,
      actionLabel: '确认删除',
      confirm: () => {
        const ok = onChange(scope,deleteBookmarkFolder(library,folder.id))
        if (ok) {
          if (currentFolder && descendants.has(currentFolder)) setFolderId(null)
          setDialog(null)
        }
        return ok
      },
    })
  }
  const moveTo = (target: string | null) => {
    if (!dialog) return
    try {
      if (dialog.type === 'move-bookmarks') {
        commit(moveBookmarks(library,dialog.urls,target),()=>{setSelected([]);setSelecting(false)})
      } else if (dialog.type === 'move-folder') {
        commit(moveBookmarkFolder(library,dialog.id,target))
      }
    } catch (error) {setFormError(error instanceof Error ? error.message : '移动失败')}
  }
  const selectedVisible = visibleBookmarks.filter(bookmark => selectedSet.has(bookmark.url)).length
  const allSelected = visibleBookmarks.length > 0 && selectedVisible === visibleBookmarks.length
  return <div className={'browser-bookmark-collection'+(isPrivate?' browser-bookmark-private':'')} aria-label={isPrivate?'隐私书签':'普通书签'}>
    {isPrivate && <div className="browser-bookmark-private-heading">
      <h3><ShieldCheck size={17} strokeWidth={1.8}/>隐私书签</h3>
      {library.bookmarks.length > 0 && <button type="button" className="browser-text-button" onClick={()=>onClear(scope)} aria-label="清空隐私书签">清空</button>}
    </div>}
    {!hasQuery && currentFolder && <nav className="browser-bookmark-breadcrumb" aria-label={isPrivate?'隐私书签目录':'书签目录'}>
      <button type="button" onClick={()=>setFolderId(null)}>全部书签</button>
      {path.map(folder => <span key={folder.id} className="browser-bookmark-crumb">
        <ChevronRight size={13}/>
        <button type="button" onClick={()=>setFolderId(folder.id)} aria-current={folder.id===currentFolder?'page':undefined}>{folder.name}</button>
      </span>)}
    </nav>}
    <div className="browser-bookmark-toolbar">
      <span className="browser-bookmark-location">
        {hasQuery ? '搜索结果' : currentFolder ? folderById.get(currentFolder)?.name : isPrivate ? '隐私收藏' : '全部收藏'}
        <small>{hasQuery ? visibleBookmarks.length : library.bookmarks.length} 个书签</small>
      </span>
      <div className="browser-bookmark-toolbar-actions">
        {selecting ? <button type="button" className="browser-text-button" onClick={()=>{setSelecting(false);setSelected([])}}>完成</button> : <>
          <BrowserIconButton label="新建文件夹" onClick={()=>openDialog({type:'new-folder'})}><FolderPlus size={20} strokeWidth={1.8}/></BrowserIconButton>
          <BrowserIconButton label="新建书签" onClick={()=>openDialog({type:'new-bookmark'})}><Plus size={20} strokeWidth={1.8}/></BrowserIconButton>
          <button type="button" className="browser-text-button" disabled={!visibleBookmarks.length} onClick={()=>setSelecting(true)}>多选</button>
        </>}
      </div>
    </div>
    {selecting && <div className="browser-bookmark-selection" role="toolbar" aria-label="批量操作">
      <button type="button" onClick={()=>setSelected(allSelected?[]:visibleBookmarks.map(item=>item.url))}>
        {allSelected?<CheckSquare size={17}/>:<span className="browser-bookmark-checkbox" aria-hidden="true"/>}
        {allSelected?'取消全选':'全选当前列表'}
      </button>
      <span className="browser-bookmark-selection-count">已选 {selected.length} 项</span>
      <button type="button" disabled={!selected.length} onClick={()=>openDialog({type:'move-bookmarks',urls:selected})}>
        <FolderInput size={17}/>移动
      </button>
      <button type="button" disabled={!selected.length} onClick={()=>askDeleteBookmark(selected)}>
        <Trash2 size={17}/>删除
      </button>
    </div>}
    {visibleFolders.length > 0 && <div className="browser-bookmark-folders">
      {visibleFolders.map(folder => <div className="browser-bookmark-folder-row" key={folder.id}>
        <button type="button" className="browser-bookmark-folder-open" onClick={()=>{setFolderId(folder.id);setSelected([]);setSelecting(false)}}
          aria-label={'打开文件夹：'+folder.name}>
          <span className="browser-bookmark-folder-icon"><Folder size={22} strokeWidth={1.6}/></span>
          <span className="browser-bookmark-folder-copy"><strong>{folder.name}</strong>
            <small>{hasQuery ? bookmarkFolderPath(library,folder.parentId).map(item=>item.name).join(' / ') || '根目录' : (counts.get(folder.id)??0)+' 个书签'}</small>
          </span>
          <ChevronRight size={17} strokeWidth={1.7} className="browser-bookmark-chevron"/>
        </button>
        <BrowserIconButton label={'管理文件夹：'+folder.name} onClick={()=>openDialog({type:'folder-actions',id:folder.id})}>
          <MoreHorizontal size={19}/></BrowserIconButton>
      </div>)}
    </div>}
    {visibleBookmarks.length > 0 && <ul className="browser-place-list browser-bookmark-items">
      {visibleBookmarks.map(bookmark => <li key={bookmark.url} className="browser-bookmark-item">
        {selecting && <button type="button" className="browser-bookmark-select" aria-label={'选择：'+bookmark.title}
          aria-pressed={selectedSet.has(bookmark.url)} onClick={()=>setSelected(current => current.includes(bookmark.url)
            ? current.filter(item=>item!==bookmark.url) : [...current,bookmark.url])}>
          {selectedSet.has(bookmark.url)?<Check size={16} strokeWidth={2.3}/>:null}
        </button>}
        <button type="button" className="browser-place-open browser-bookmark-open"
          aria-label={'打开：'+bookmark.title} onClick={()=>selecting ? setSelected(current => current.includes(bookmark.url)
            ? current.filter(item=>item!==bookmark.url) : [...current,bookmark.url]) : onOpen(bookmark.url)}>
          <BrowserSiteIcon url={bookmark.url} name={bookmark.title} size="small" allowRemote={!privateMode && !isPrivate}/>
          <span className="browser-place-copy">
            <span className="browser-place-title">{bookmark.title}</span>
            <span className="browser-place-meta"><span>{hasQuery ? bookmarkFolderPath(library,bookmark.folderId).map(item=>item.name).join(' / ') || bookmark.url : bookmark.url}</span></span>
          </span>
        </button>
        {!selecting && <><BrowserIconButton label={'更多操作：'+bookmark.title}
          onClick={()=>openDialog({type:'bookmark-actions',url:bookmark.url})}><MoreHorizontal size={19} strokeWidth={1.8}/></BrowserIconButton>
          <BrowserIconButton label={'删除：'+bookmark.title} className="browser-bookmark-direct-delete"
            onClick={()=>commit(deleteBookmarks(library,[bookmark.url]))}><Trash2 size={17} strokeWidth={1.8}/></BrowserIconButton></>}
      </li>)}
    </ul>}
    {!visibleBookmarks.length && !visibleFolders.length && <BrowserEmptyState icon={hasQuery?Search:Bookmark}
      title={hasQuery?'没有找到相关书签':'这里还没有书签'}
      description={hasQuery?'试试其他关键词':currentFolder?'可以把书签移动到这个文件夹':'从网页菜单添加书签，或在这里新建'}/>}
    {dialog && <BrowserSheet title={dialog.type === 'new-folder'?'新建文件夹':dialog.type === 'rename-folder'?'重命名文件夹':
      dialog.type === 'new-bookmark'?'新建书签':dialog.type === 'edit-bookmark'?'编辑书签':
      dialog.type === 'move-folder'?'移动文件夹':dialog.type === 'move-bookmarks'?'移动书签':'更多操作'} onClose={()=>setDialog(null)}>
      {formError && <BrowserStatusBanner error>{formError}</BrowserStatusBanner>}
      {(dialog.type==='new-folder'||dialog.type==='rename-folder'||dialog.type==='new-bookmark'||dialog.type==='edit-bookmark') &&
        <form className="browser-bookmark-form" onSubmit={submit}>
          <label htmlFor={'browser-bookmark-name-'+scope}>{dialog.type.includes('folder')?'文件夹名称':'书签名称'}</label>
          <input autoFocus id={'browser-bookmark-name-'+scope} aria-label={dialog.type.includes('folder')?'文件夹名称':'书签名称'}
            value={name} maxLength={dialog.type.includes('folder')?80:160} onChange={event=>setName(event.currentTarget.value)}
            placeholder={dialog.type.includes('folder')?'输入文件夹名称':'输入书签标题'}/>
          {(dialog.type==='new-bookmark'||dialog.type==='edit-bookmark') && <>
            <label htmlFor={'browser-bookmark-url-'+scope}>网址</label>
            <input id={'browser-bookmark-url-'+scope} aria-label="书签网址" inputMode="url" value={address}
              onChange={event=>setAddress(event.currentTarget.value)} placeholder="https://example.com" autoCapitalize="off" autoCorrect="off"/>
          </>}
          <button type="submit" className="browser-action-button browser-action-primary">保存</button>
        </form>}
      {(dialog.type==='folder-actions'||dialog.type==='bookmark-actions') && <div className="browser-bookmark-action-list">
        <button type="button" onClick={()=>openDialog(dialog.type==='folder-actions'
          ? {type:'rename-folder',id:dialog.id}:{type:'edit-bookmark',url:dialog.url})}>
          <Pencil size={19}/>{dialog.type==='folder-actions'?'重命名文件夹':'编辑名称和网址'}
        </button>
        <button type="button" onClick={()=>openDialog(dialog.type==='folder-actions'
          ? {type:'move-folder',id:dialog.id}:{type:'move-bookmarks',urls:[dialog.url]})}>
          <FolderInput size={19}/>移动到文件夹
        </button>
        <button type="button" className="browser-bookmark-danger" onClick={()=>{
          if (dialog.type==='folder-actions') {
            const folder=folderById.get(dialog.id); if (folder) askDeleteFolder(folder)
          } else askDeleteBookmark([dialog.url])
        }}><Trash2 size={19}/>删除</button>
      </div>}
      {(dialog.type==='move-folder'||dialog.type==='move-bookmarks') && <div className="browser-bookmark-destinations">
        <p>选择目标文件夹</p>
        {bookmarkFolderOptions(library,dialog.type==='move-folder'?dialog.id:undefined).map(option=>
          <button type="button" key={option.id??'root'} onClick={()=>moveTo(option.id)}
            style={{paddingLeft: 14 + Math.min(option.depth, 8)*18}} aria-label={'移动到：'+option.label}>
            <Folder size={18}/><span>{option.label}</span><ChevronRight size={16}/>
          </button>)}
      </div>}
    </BrowserSheet>}
  </div>
}

export function BrowserBookmarkManager({
  normal, privateLibrary, privateMode, onBack, onOpen, onChange, onClear, onConfirm, onRegisterBack,
}: Props) {
  const [query,setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [privateUnlocked,setPrivateUnlocked] = useState(false)
  const taps = useRef<PrivateBookmarkTap>(EMPTY_PRIVATE_BOOKMARK_TAP)
  const [scopeBacks] = useState(() => ({
    normal: (()=>false) as ()=>boolean,
    private: (()=>false) as ()=>boolean,
  }))
  useEffect(() => {
    onRegisterBack?.(() => scopeBacks.private() || scopeBacks.normal())
    return () => onRegisterBack?.(() => false)
  }, [onRegisterBack,scopeBacks])
  const registerNormal = useMemo(() => (fn:()=>boolean) => {scopeBacks.normal=fn},[scopeBacks])
  const registerPrivate = useMemo(() => (fn:()=>boolean) => {scopeBacks.private=fn},[scopeBacks])
  const unlockPrivate = () => {
    const result = advancePrivateBookmarkTap(taps.current,Date.now())
    taps.current=result.state
    if (result.activated) setPrivateUnlocked(value=>!value)
  }
  const needle=query.trim().toLocaleLowerCase()
  const privateVisible=privateMode && privateUnlocked
  return <section aria-label="书签" className="browser-panel browser-places browser-bookmark-manager"
    style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}
    onClickCapture={event=>{
      if (privateMode && !(event.target as Element).closest('.browser-page-title-tap')) {
        taps.current=EMPTY_PRIVATE_BOOKMARK_TAP
      }
    }}>
    <BrowserPageHeader title="书签" onBack={onBack} onTitleActivate={privateMode?unlockPrivate:undefined}>
      {normal.bookmarks.length > 0 && <button type="button" aria-label="清空书签" className="browser-text-button"
        onClick={()=>onClear('normal')}>清空</button>}
    </BrowserPageHeader>
    <div className="browser-places-filter browser-bookmark-filter">
      <div className="browser-input-field">
        <Search size={19} strokeWidth={1.8}/>
        <input type="search" aria-label="搜索书签" placeholder="搜索书签、文件夹或网址" ref={input}
          value={query} autoComplete="off" onChange={event=>setQuery(event.currentTarget.value)}/>
        {query && <BrowserIconButton label="清空搜索" onClick={()=>{setQuery('');input.current?.focus()}}><X size={18}/></BrowserIconButton>}
      </div>
      <p className="browser-results-count">
        {needle ? '正在搜索全部文件夹' : '共 '+normal.bookmarks.length+' 个普通书签 · '+normal.folders.length+' 个文件夹'}
      </p>
    </div>
    <div className="browser-panel-scroll">
      <div className="browser-places-content browser-bookmark-content">
        <BookmarkCollection scope="normal" library={normal} privateMode={privateMode} query={needle} onOpen={onOpen}
          onChange={onChange} onClear={onClear} onConfirm={onConfirm} registerBack={registerNormal}/>
        {privateVisible && <BookmarkCollection scope="private" library={privateLibrary} privateMode={privateMode} query={needle} onOpen={onOpen}
          onChange={onChange} onClear={onClear} onConfirm={onConfirm} registerBack={registerPrivate}/>}
      </div>
    </div>
  </section>
}

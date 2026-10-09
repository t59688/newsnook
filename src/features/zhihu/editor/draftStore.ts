import {
  createIndexedDbZhihuEditorDatabase,
  type ZhihuEditorDatabase,
} from '../storage/database'
import {
  createEmptyZhihuDocument,
  createZhihuLocalId,
  type ZhihuDraftKind,
  type ZhihuDraftSnapshot,
  validateZhihuDraftSnapshot,
} from './schema'

function draftKey(accountId: string, localDraftId: string): string {
  return `${accountId}:${localDraftId}`
}

export class ZhihuDraftStore {
  private readonly database: ZhihuEditorDatabase

  constructor(database: ZhihuEditorDatabase = createIndexedDbZhihuEditorDatabase()) {
    this.database = database
  }

  async create(accountId: string, kind: ZhihuDraftKind, targetId?: string): Promise<ZhihuDraftSnapshot> {
    if (!accountId) throw new Error('创建知乎草稿需要账号作用域')
    if (kind === 'answer' && !targetId) throw new Error('回答草稿必须绑定 questionId')
    const now = Date.now()
    const snapshot: ZhihuDraftSnapshot = {
      schemaVersion: 1,
      localDraftId: createZhihuLocalId(),
      accountId,
      kind,
      targetId,
      document: createEmptyZhihuDocument(),
      assets: [],
      localRevision: 0,
      publishState: 'local',
      createdAt: now,
      updatedAt: now,
    }
    return this.save(snapshot)
  }

  async save(input: ZhihuDraftSnapshot): Promise<ZhihuDraftSnapshot> {
    const validated = validateZhihuDraftSnapshot(input)
    const key = draftKey(validated.accountId, validated.localDraftId)
    const currentRecord = await this.database.getDraft(key)
    const current = currentRecord ? validateZhihuDraftSnapshot(currentRecord.value) : null
    const next: ZhihuDraftSnapshot = {
      ...validated,
      localRevision: Math.max(validated.localRevision, current?.localRevision ?? -1) + 1,
      createdAt: current?.createdAt ?? validated.createdAt,
      updatedAt: Date.now(),
    }
    await this.database.putDraft({
      key,
      accountId: next.accountId,
      localDraftId: next.localDraftId,
      value: next,
      updatedAt: next.updatedAt,
    })
    return next
  }

  async get(accountId: string, localDraftId: string): Promise<ZhihuDraftSnapshot | null> {
    const record = await this.database.getDraft(draftKey(accountId, localDraftId))
    return record ? validateZhihuDraftSnapshot(record.value) : null
  }

  async list(accountId: string): Promise<ZhihuDraftSnapshot[]> {
    const records = await this.database.listDrafts(accountId)
    return records
      .map((record) => validateZhihuDraftSnapshot(record.value))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async copy(accountId: string, localDraftId: string): Promise<ZhihuDraftSnapshot> {
    const source = await this.get(accountId, localDraftId)
    if (!source) throw new Error('要复制的知乎草稿不存在')
    const now = Date.now()
    const copy: ZhihuDraftSnapshot = {
      ...structuredClone(source),
      localDraftId: createZhihuLocalId(),
      remoteDraftId: undefined,
      publishedContentId: undefined,
      publishState: 'local',
      publishOperationId: undefined,
      localRevision: 0,
      createdAt: now,
      updatedAt: now,
      title: source.title ? `${source.title} - 副本` : source.title,
    }
    return this.save(copy)
  }

  delete(accountId: string, localDraftId: string): Promise<void> {
    return this.database.deleteDraft(draftKey(accountId, localDraftId))
  }

  async putAssetBlob(
    accountId: string,
    localDraftId: string,
    assetId: string,
    blob: Blob,
    mediaType: string,
    fileName?: string,
  ): Promise<void> {
    await this.database.putBlob({
      key: `${accountId}:${localDraftId}:${assetId}`,
      accountId,
      localDraftId,
      assetId,
      blob,
      mediaType,
      fileName,
      createdAt: Date.now(),
    })
  }

  async getAssetBlob(accountId: string, localDraftId: string, assetId: string): Promise<Blob | null> {
    return (await this.database.getBlob(`${accountId}:${localDraftId}:${assetId}`))?.blob ?? null
  }

  deleteAssetBlob(accountId: string, localDraftId: string, assetId: string): Promise<void> {
    return this.database.deleteBlob(`${accountId}:${localDraftId}:${assetId}`)
  }
}

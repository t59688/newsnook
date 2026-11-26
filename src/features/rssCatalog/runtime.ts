import { CatalogService } from './service'
import { catalogStorage } from './storage'
import seedUrl from './seed.json?url'

/** Read the bundled catalog as ordinary JSON inside the classic Worker.
 * Importing it as JS retains a second 12MB module and blocks script parsing. */
export const rssCatalogService = new CatalogService({
  seed: async () => {
    const response = await fetch(seedUrl, { credentials: 'omit', cache: 'force-cache' })
    if (!response.ok) throw new Error('内置 RSS 目录文件无法读取')
    return response.json()
  },
  storage: catalogStorage,
})

import { CatalogService } from './service'
import { catalogStorage } from './storage'

export const rssCatalogService = new CatalogService({
  seed: async () => (await import('./seed.json')).default,
  storage: catalogStorage,
})

import type { FrameworkId } from '../../frameworkDetect/types'
import type { CatalogRequest } from '../types'

export type CatalogSemantic = 'category' | 'genre' | 'year' | 'region' | 'language' | 'status' | 'tag' | 'sort' | 'custom'
export interface CatalogEvidence {
  confidence: 'direct' | 'corroborated'
  /** Inspectable rule names, not an uncalibrated probability. No credentials or HTML. */
  signals: string[]
}
export interface CatalogChoice {
  id: string
  title: string
  selected: boolean
  request: CatalogRequest
}
export interface CatalogControl {
  id: string
  title: string
  kind: 'filter' | 'sort'
  semantic: CatalogSemantic
  selection: 'single' | 'multiple'
  choices: CatalogChoice[]
  evidence: CatalogEvidence
}
export interface CatalogCapabilityIssue {
  kind: 'filter' | 'search' | 'pagination'
  reason: 'javascript-control' | 'session-field' | 'unsafe-form' | 'unsupported-form' | 'budget'
  title: string
}
/** Response-only actions: never persisted or merged with another page's form state. */
export interface CatalogCapabilities {
  version: 1
  source: 'html' | 'rendered'
  engine: FrameworkId
  controls: CatalogControl[]
  search?: CatalogRequest
  searchEvidence?: CatalogEvidence
  nextRequest?: CatalogRequest
  issues: CatalogCapabilityIssue[]
}
export const CONTROL_ATTRIBUTE = 'data-newsnook-catalog-control'
export const CONTROL_SELECTOR = `[${CONTROL_ATTRIBUTE}]`
export const MAX_CONTROLS = 24
export const MAX_CHOICES = 100
export const MAX_FORM_FIELDS = 128

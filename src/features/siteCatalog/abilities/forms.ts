import type { FrameworkId } from '../../frameworkDetect/types'
import { isSensitiveCatalogField, searchCapabilityUrl } from '../context'
import { isNextPageLabel } from '../navigationRoles'
import type { CatalogRequest } from '../types'
import { CONTROL_ATTRIBUTE, MAX_CHOICES, MAX_CONTROLS, MAX_FORM_FIELDS, type CatalogCapabilities, type CatalogCapabilityIssue, type CatalogControl } from './types'
import { controlSemantic, fieldRole, SEMANTIC_TITLES } from './semantics'
import { compactSearchTemplate, materializeCatalogRequest, replaceFields, type CatalogField } from './requestPlan'

const MUTATING = /(?:^|[\s/_.?&=-])(?:login|logout|signin|signup|register|delete|remove|upload|subscribe|unsubscribe|purchase|checkout|payment|password|comment|vote|account|settings|preferences|profile|save|update|create|edit|admin)(?:$|[\s/_.?&=-])|登录|注册|删除|购买|支付|上传|发表评论|保存|修改|更新设置|账户设置/i
const READ_LABEL = /搜索|搜寻|查询|筛选|检索|应用|确定|search|filter|apply|find|go/i
const SUBMIT = 'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]'
const trim = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim()

/** Disabled fieldset excludes descendants except its first legend, as in HTML submission. */
function disabled(node: Element): boolean {
  if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') return true
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'OPTGROUP' && parent.hasAttribute('disabled')) return true
    if (parent.tagName !== 'FIELDSET' || !parent.hasAttribute('disabled')) continue
    const legend = [...parent.children].find(child => child.tagName === 'LEGEND')
    if (!legend?.contains(node)) return true
  }
  return false
}
function controlType(node: Element): string {
  return node.tagName === 'INPUT' ? (node.getAttribute('type') || 'text').toLowerCase() : node.tagName.toLowerCase()
}
function simpleText(node: Element | null | undefined): string {
  if (!node) return ''
  const clone = node.cloneNode(true) as Element
  for (const child of clone.querySelectorAll('input, select, textarea, button')) child.remove()
  return trim(clone.textContent).slice(0, 80)
}
function labelFor(node: Element, document: Document): string {
  const explicit = node.getAttribute('aria-label') || node.getAttribute('title')
  if (explicit) return trim(explicit).slice(0, 80)
  const id = node.getAttribute('id')
  const label = id && [...document.querySelectorAll('label[for]')].find(item => item.getAttribute('for') === id)
  return simpleText(label || node.closest('label'))
}
function groupLabel(node: Element, document: Document): string {
  const fieldset = node.closest('fieldset')
  const legend = fieldset && [...fieldset.children].find(child => child.tagName === 'LEGEND')
  return simpleText(legend) || labelFor(node, document)
}
function valueOf(node: Element): string {
  return node.getAttribute('value') ?? (node.tagName === 'OPTION' || node.tagName === 'TEXTAREA' ? node.textContent || '' : /^(?:radio|checkbox)$/.test(controlType(node)) ? 'on' : '')
}
function owns(form: Element, control: Element): boolean {
  const owner = control.getAttribute('form')
  return owner != null ? Boolean(owner && owner === form.getAttribute('id')) : control.closest('form') === form
}
function selectedValues(node: Element, request: CatalogRequest, action: string): string[] {
  if (node.tagName !== 'SELECT') return [valueOf(node)]
  const options = [...node.querySelectorAll('option')]
  const selected = options.filter(option => option.hasAttribute('selected'))
  if (selected.length) return (node.hasAttribute('multiple') ? selected : selected.slice(-1)).filter(option => !disabled(option)).map(valueOf)
  // Unmarked server-rendered selects can still expose their current query value.
  const requestUrl = new URL(request.url), actionUrl = new URL(action)
  if (requestUrl.origin === actionUrl.origin && requestUrl.pathname === actionUrl.pathname) {
    const name = node.getAttribute('name') || ''
    const existing = request.method === 'POST'
      ? (request.fields ?? Object.entries(request.form ?? {}).map(([key, value]) => ({ name: key, value }))).filter(field => field.name === name).map(field => field.value)
      : requestUrl.searchParams.getAll(name)
    const matched = options.filter(option => !disabled(option) && existing.includes(valueOf(option))).map(valueOf)
    if (matched.length) return node.hasAttribute('multiple') ? matched : matched.slice(-1)
  }
  if (node.hasAttribute('multiple')) return []
  const first = options.find(option => !disabled(option))
  return first ? [valueOf(first)] : []
}
function successfulFields(controls: Element[], submitter: Element | undefined, request: CatalogRequest, action: string): CatalogField[] {
  const fields: CatalogField[] = []
  for (const node of controls) {
    const name = node.getAttribute('name')
    if (!name || disabled(node)) continue
    const type = controlType(node)
    if (type === 'button' || /^(?:submit|reset|image|button)$/.test(type)) {
      if (node === submitter) fields.push({ name, value: valueOf(node) })
      continue
    }
    if (/^(?:checkbox|radio)$/.test(type) && !node.hasAttribute('checked')) continue
    for (const value of selectedValues(node, request, action)) fields.push({ name, value })
  }
  return fields
}
function inputTitle(node: Element, document: Document): string {
  return labelFor(node, document) || valueOf(node)
}

export interface FormDiscovery extends Pick<CatalogCapabilities, 'controls' | 'search' | 'searchEvidence' | 'nextRequest' | 'issues'> {}

/** Read-only standard forms only. No upstream JS is evaluated or inferred endpoint probed. */
export function discoverFormCapabilities(document: Document, baseUrl: string, engine: FrameworkId, request: CatalogRequest): FormDiscovery {
  const result: FormDiscovery = { controls: [], issues: [] }
  const allControls = [...document.querySelectorAll('input, select, textarea, button')]
  for (const [formIndex, form] of [...document.querySelectorAll('form')].slice(0, 24).entries()) {
    const controls = allControls.filter(node => owns(form, node))
    const enabled = controls.filter(node => !disabled(node))
    const query = enabled.find(node => node.tagName === 'INPUT' && !/^(?:hidden|submit|reset|checkbox|radio|password|file|button)$/.test(controlType(node))
      && (controlType(node) === 'search' || fieldRole(node.getAttribute('name') || '', engine) === 'search'))
    const hasSelect = enabled.some(node => node.tagName === 'SELECT' || /^(?:checkbox|radio)$/.test(controlType(node)))
    const isPager = Boolean(form.closest('.pagination, .pager, [aria-label="Pagination"], [aria-label="分页"]'))
    if (!query && !hasSelect && !isPager) continue
    const kind: CatalogCapabilityIssue['kind'] = query ? 'search' : isPager ? 'pagination' : 'filter'
    const issue = (reason: CatalogCapabilityIssue['reason']) => result.issues.push({ kind, reason, title: trim(form.getAttribute('aria-label')) || (query ? '搜索' : '筛选') })
    if (controls.length > MAX_FORM_FIELDS || enabled.some(node => (node.getAttribute('name') || '').length > 100 || valueOf(node).length > 4096)) { issue('budget'); continue }
    const submitters = enabled.filter(node => node.matches(SUBMIT))
    const submitter = submitters.find(node => READ_LABEL.test(trim(node.textContent) || node.getAttribute('value') || '')) ?? submitters[0]
    const rawAction = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? request.url
    const method = (submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'GET').toUpperCase()
    const encoding = submitter?.getAttribute('formenctype') ?? form.getAttribute('enctype') ?? 'application/x-www-form-urlencoded'
    if (!['GET', 'POST'].includes(method) || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(encoding)) { issue('unsupported-form'); continue }
    if (enabled.some(node => /^(?:password|file)$/.test(controlType(node)))
      || MUTATING.test(rawAction + ' ' + (submitter?.textContent || '') + ' ' + (submitter?.getAttribute('value') || '') + ' ' + (submitter?.getAttribute('name') || ''))
      || enabled.some(node => /^(?:action|operation|op)$/i.test(node.getAttribute('name') || '') && MUTATING.test(valueOf(node)))) { issue('unsafe-form'); continue }
    const readIntent = Boolean(query) || isPager || READ_LABEL.test(submitter?.textContent || submitter?.getAttribute('value') || '')
      || /(?:^|[\s/_-])(?:search|filter|browse|catalog|list|query|find|views-exposed)(?:$|[\s/_.?-])/i.test(rawAction + ' ' + (form.getAttribute('class') || '') + ' ' + (form.getAttribute('role') || ''))
    if (method === 'POST' && !readIntent) { issue('unsafe-form'); continue }
    if (enabled.some(node => isSensitiveCatalogField(node.getAttribute('name') || ''))) { issue('session-field'); continue }
    const action = searchCapabilityUrl(rawAction || request.url, baseUrl)
    if (!action) { issue(/[?&](?:[^=]*(?:token|session|sessid|csrf|nonce)[^=]*)=/i.test(rawAction) ? 'session-field' : 'unsafe-form'); continue }
    if (/preventDefault\s*\(|return\s+false/i.test(form.getAttribute('onsubmit') || '')) { issue('javascript-control'); continue }
    const fields = successfulFields(controls, submitter, request, action)
    const formId = `form-${formIndex}`
    let added = false
    const rewrite = form.getAttribute('data-action')
    if (query && !result.search) {
      const queryName = query.getAttribute('name')
      if (queryName) {
        const rewriteUrl = rewrite?.includes('FFWD') ? searchCapabilityUrl(rewrite.replace('FFWD', '{query}'), baseUrl) : undefined
        result.search = rewriteUrl
          ? { url: rewriteUrl.replace(/%7Bquery%7D/gi, '{query}'), method: 'GET' }
          : compactSearchTemplate(action, method as 'GET' | 'POST', [...fields.filter(field => field.name !== queryName), { name: queryName, value: '{query}' }])
        result.searchEvidence = { confidence: 'direct', signals: ['search-control', 'form-action', 'successful-controls'] }
        added = true
      }
    }
    const names = new Set<string>()
    for (const node of enabled) {
      const name = node.getAttribute('name')
      const type = controlType(node)
      if (!name || names.has(name) || !(type === 'select' || type === 'radio' || type === 'checkbox')) continue
      names.add(name)
      const label = groupLabel(node, document)
      const semantic = controlSemantic(name, label, engine)
      if (fieldRole(name, engine) === 'pagination') continue
      if (!semantic && !query && !/filter|search|筛选|检索/i.test(form.getAttribute('role') || form.getAttribute('class') || label)) continue
      const role = semantic || 'custom'
      const group = type === 'select' ? [node] : enabled.filter(item => item.getAttribute('name') === name && controlType(item) === type)
      const options = type === 'select' ? [...node.querySelectorAll('option')].filter(item => !disabled(item)) : group
      if (!options.length) continue
      const multiple = type === 'checkbox' || node.hasAttribute('multiple')
      const currentValues = fields.filter(field => field.name === name).map(field => field.value)
      const title = (label && label.length <= 40 ? label : SEMANTIC_TITLES[role]).replace(/[:：]\s*$/, '')
      const seenValues = new Set<string>()
      const choices = options.slice(0, MAX_CHOICES).flatMap((option, index) => {
        const value = valueOf(option)
        const optionTitle = (type === 'select' ? trim(option.textContent) : inputTitle(option, document)).slice(0, 100)
        if (!optionTitle || value.length > 4096 || seenValues.has(value)) return []
        seenValues.add(value)
        const selected = currentValues.includes(value)
        const nextValues = multiple ? (selected ? currentValues.filter(current => current !== value) : [...currentValues, value]) : [value]
        return [{ id: `${formId}:${name}:${index}`, title: optionTitle, selected, request: materializeCatalogRequest(action, method as 'GET' | 'POST', replaceFields(fields, name, nextValues)) }]
      })
      if (choices.length && result.controls.length < MAX_CONTROLS) {
        const control: CatalogControl = { id: `${formId}:${name}`, title, semantic: role, kind: role === 'sort' ? 'sort' : 'filter', selection: multiple ? 'multiple' : 'single', choices, evidence: { confidence: 'direct', signals: ['form-action', 'successful-controls', ...(semantic ? ['field-or-label'] : ['search-form-context'])] } }
        result.controls.push(control)
        added = true
      }
    }
    if (isPager) {
      for (const button of submitters) {
        if (!isNextPageLabel(trim(button.getAttribute('aria-label') || button.textContent || button.getAttribute('value')))) continue
        const nextAction = searchCapabilityUrl(button.getAttribute('formaction') ?? form.getAttribute('action') ?? request.url, baseUrl)
        const nextMethod = (button.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'GET').toUpperCase()
        const nextEncoding = button.getAttribute('formenctype') ?? form.getAttribute('enctype') ?? 'application/x-www-form-urlencoded'
        if (!nextAction || !['GET', 'POST'].includes(nextMethod) || MUTATING.test(nextAction)
          || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(nextEncoding)) continue
        result.nextRequest = materializeCatalogRequest(nextAction, nextMethod as 'GET' | 'POST', successfulFields(controls, button, request, nextAction))
        added = true
        break
      }
    }
    if (added) {
      // A CMS can wrap its results and filter bar in one form. Only controls are
      // excluded in that case; claiming the entire form would erase the results.
      if (form.querySelector('article, .card, .views-row, .blog-item, h2 a, h3 a, h4 a, h5 a, h6 a')) {
        for (const node of controls) node.setAttribute(CONTROL_ATTRIBUTE, '')
      } else form.setAttribute(CONTROL_ATTRIBUTE, '')
    }
  }
  return result
}

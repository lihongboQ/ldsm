const STORAGE_KEY = 'ldsm.scan.form'

/**
 * 所有需要记住的填报项（含隐藏提交字段、粘贴框、分支模式）
 * 数值字段：language / jdkVersion / pkToolTemplate
 */
export const MEMORY_KEYS = [
  'assignee',
  'qkName',
  'taskName',
  'goal',
  'language',
  'gitUsername',
  'gitPassword',
  'projectUrl',
  'targetBranch',
  'commitId',
  'cookie',
  'isJ2ee',
  'jdkVersion',
  'pkToolTemplate',
  'branchMode',
  'pasteText',
]

/** 兼容旧版只存 Git 的 key */
const LEGACY_GIT_KEY = 'ldsm.scan.git'

function pickMemory(data) {
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const key of MEMORY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      out[key] = data[key]
    }
  }
  return out
}

export function loadFormMemory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      const picked = pickMemory(data)
      if (Object.keys(picked).length) return picked
    }

    // 迁移旧 Git 记忆
    const legacy = localStorage.getItem(LEGACY_GIT_KEY)
    if (legacy) {
      return pickMemory(JSON.parse(legacy))
    }
  } catch {
    // ignore
  }
  return {}
}

export function saveFormMemory(form, extra = {}) {
  const prev = loadFormMemory()
  const payload = { ...prev }
  for (const key of MEMORY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) {
      payload[key] = extra[key]
      continue
    }
    if (form && Object.prototype.hasOwnProperty.call(form, key)) {
      const value = form[key]
      payload[key] = value == null ? '' : value
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearFormMemory() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_GIT_KEY)
}

/** @deprecated 兼容旧引用 */
export const GIT_KEYS = [
  'gitUsername',
  'gitPassword',
  'projectUrl',
  'targetBranch',
  'commitId',
]
export const loadGitInfo = loadFormMemory
export const saveGitInfo = saveFormMemory
export const clearGitInfo = clearFormMemory

const STORAGE_KEY = 'ldsm.scan.git'

const GIT_KEYS = ['gitUsername', 'gitPassword', 'projectUrl', 'targetBranch', 'commitId']

export function loadGitInfo() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    return Object.fromEntries(GIT_KEYS.map((key) => [key, data[key] ?? '']))
  } catch {
    return {}
  }
}

export function saveGitInfo(form) {
  const payload = Object.fromEntries(
    GIT_KEYS.map((key) => [key, String(form[key] ?? '')]),
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearGitInfo() {
  localStorage.removeItem(STORAGE_KEY)
}

export { GIT_KEYS }

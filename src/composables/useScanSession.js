import { reactive, watch } from 'vue'
import { DEFAULT_TASK } from '../constants/scan'

const GIT_STORAGE_KEY = 'ldsm.scan.git'

const GIT_FIELDS = [
  'gitUsername',
  'gitPassword',
  'projectUrl',
  'targetBranch',
  'commitId',
]

function readGitFromBrowser() {
  try {
    const raw = localStorage.getItem(GIT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out = {}
    for (const key of GIT_FIELDS) {
      if (typeof parsed[key] === 'string') out[key] = parsed[key]
    }
    return out
  } catch {
    return {}
  }
}

function writeGitToBrowser(source) {
  const payload = {}
  for (const key of GIT_FIELDS) {
    payload[key] = String(source[key] ?? '')
  }
  localStorage.setItem(GIT_STORAGE_KEY, JSON.stringify(payload))
}

/** 填报会话唯一入口：Cookie 用代码默认值；Git 读写浏览器 */
export const scanSession = reactive({
  cookie: DEFAULT_TASK.cookie,
  gitUsername: '',
  gitPassword: '',
  projectUrl: '',
  targetBranch: '',
  commitId: '',
})

Object.assign(scanSession, readGitFromBrowser())

let gitWatchStarted = false

/** 启动 Git 字段 → localStorage 同步（全局只挂一次） */
export function startGitPersistence() {
  if (gitWatchStarted) return
  gitWatchStarted = true
  watch(
    () => GIT_FIELDS.map((key) => scanSession[key]),
    () => writeGitToBrowser(scanSession),
    { deep: false },
  )
}

/** 从表单同步 Git 到会话并落盘 */
export function syncGitFromForm(form) {
  for (const key of GIT_FIELDS) {
    scanSession[key] = String(form[key] ?? '')
  }
  writeGitToBrowser(scanSession)
}

/** 读取浏览器中的 Git 信息 */
export function loadGitFromBrowser() {
  return readGitFromBrowser()
}

export { GIT_FIELDS, GIT_STORAGE_KEY }

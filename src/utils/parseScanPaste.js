/**
 * 快递单式粘贴识别（多层）：
 * 1) 规范化 + 隔离 Cookie
 * 2) 结构化强信号（GitLab/GitHub 链接、git clone、-b 分支）
 * 3) 标签键值（名称/分支/commit/语言…）
 * 4) 裸字段兜底
 * 5) 缺口推断（仓库名→名称、路径关键词→语言）
 *
 * 高置信覆盖低置信；同字段多候选取分最高者。
 */

const FIELD_LABELS = {
  qkName: '名称',
  taskName: '任务名',
  projectUrl: '项目地址',
  targetBranch: '目标分支',
  commitId: 'Commit ID',
  language: '语言',
  gitUsername: 'Git 名称',
  gitPassword: 'Git 密码',
  cookie: 'Cookie',
}

const LANG_FROM_TEXT = [
  { re: /\b(js\/?ts|javascript|typescript|\.tsx?\b|vue\b|node\.?js)\b/i, value: 9, why: '文本含 JS/TS/Vue' },
  { re: /\bjava\s*\(android\)|android\b/i, value: 7, why: '文本含 Android' },
  { re: /\bjava\b(?!\s*\()/i, value: 0, why: '文本含 Java' },
  { re: /\bc\s*\/\s*c\+\+|c\+\+|\.cpp\b/i, value: 1, why: '文本含 C/C++' },
  { re: /\bc#\b|csharp|\.cs\b/i, value: 2, why: '文本含 C#' },
  { re: /\bpython\b|\.py\b/i, value: 3, why: '文本含 Python' },
  { re: /\bphp\b|\.php\b/i, value: 4, why: '文本含 PHP' },
  { re: /\bgolang\b|\bgo\b(?!\w)/i, value: 12, why: '文本含 Go' },
  { re: /\bkotlin\b|\.kt\b/i, value: 16, why: '文本含 Kotlin' },
  { re: /\bswift\b|\.swift\b/i, value: 15, why: '文本含 Swift' },
  { re: /\bruby\b|\.rb\b/i, value: 13, why: '文本含 Ruby' },
  { re: /\bscala\b/i, value: 17, why: '文本含 Scala' },
  { re: /\blua\b/i, value: 18, why: '文本含 Lua' },
  { re: /\bshell\b|\.sh\b/i, value: 19, why: '文本含 Shell' },
]

/** 仓库路径/名称启发式 → 语言 */
const LANG_FROM_PATH = [
  { re: /(vue|react|angular|frontend|front-?end|web[-_]?ui|typescript|javascript|nodejs|h5|uni-?app|miniprogram)/i, value: 9 },
  { re: /(android|apk)/i, value: 7 },
  { re: /(spring|maven|backend|java[-_]?svc|jdk)/i, value: 0 },
  { re: /(python|django|flask|fastapi)/i, value: 3 },
  { re: /(golang|[-_/]go[-_/])/i, value: 12 },
  { re: /(kotlin)/i, value: 16 },
  { re: /(swift|ios[-_])/i, value: 15 },
  { re: /(php|laravel)/i, value: 4 },
]

const BRANCH_NAME_RE = /^(?!https?:)(?![0-9a-f]{40}$)[A-Za-z0-9._/-]{2,200}$/
const COMMIT_RE = /^[0-9a-f]{7,40}$/i
const FULL_COMMIT_RE = /\b([0-9a-f]{40})\b/i

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRaw(raw) {
  return String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/[：]/g, ':')
    .replace(/[＝]/g, '=')
    .trim()
}

/** 把 Cookie 从正文抠出，避免污染密码/哈希识别 */
function extractCookie(text) {
  const hasXsrf = /XSRF-TOKEN\s*=/i.test(text)
  const hasJsess = /JSESSIONID\s*=/i.test(text)
  if (!hasXsrf && !hasJsess) return { cookie: '', rest: text }

  const parts = []
  const xsrf = text.match(/XSRF-TOKEN\s*=\s*([^;\s\n]+)/i)
  const jsess = text.match(/JSESSIONID\s*=\s*([^;\s\n]+)/i)
  if (xsrf) parts.push(`XSRF-TOKEN=${xsrf[1]}`)
  if (jsess) parts.push(`JSESSIONID=${jsess[1]}`)

  let rest = text
    .replace(/XSRF-TOKEN\s*=\s*[^;\s\n]+;?/gi, ' ')
    .replace(/JSESSIONID\s*=\s*[^;\s\n]+;?/gi, ' ')
    .replace(/\s{2,}/g, ' ')

  return { cookie: parts.join('; '), rest }
}

function scorePick(bag, field, value, confidence, source) {
  if (value === '' || value == null) return
  const prev = bag[field]
  if (prev && prev.confidence > confidence) return
  if (prev && prev.confidence === confidence && prev.source === source) return
  bag[field] = { value, confidence, source }
}

function stripOrigin(branch) {
  return String(branch || '').replace(/^origin\//, '').replace(/^refs\/heads\//, '')
}

function cleanUrl(url) {
  let u = String(url || '').trim()
  u = u.replace(/[)\]>,;，；'"》】]+$/g, '')
  // 去掉查询与 hash（保留 path 里的 tree/commit 已在上游处理）
  u = u.split('#')[0]
  // 若仍是浏览页 path，尽量收成裸仓库根
  u = u
    .replace(/\/-\/(tree|blob|commits?|merge_requests|issues|wikis|pipelines|tags)\/.*$/i, '')
    .replace(/\/(tree|blob|commit|commits|pull|issues|wiki)\/.*$/i, '')
    .replace(/\/-\/?$/i, '')
  if (!/\.git$/i.test(u) && /\/[^/]+$/i.test(u) && !/[?#]/.test(u)) {
    // 保持原样；平台多数可接受无 .git
  }
  return u
}

function repoSlug(url) {
  const m = String(url || '').match(/\/([^/]+?)(?:\.git)?\/?$/i)
  return m ? m[1] : ''
}

function humanizeSlug(slug) {
  if (!slug) return ''
  return slug
    .replace(/\.git$/i, '')
    .replace(/^x\d+[-_]/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

function looksLikeCnTitle(line) {
  if (!line || line.length > 48) return false
  if (/https?:|git@|XSRF|JSESSIONID/i.test(line)) return false
  if (COMMIT_RE.test(line)) return false
  if (/^(分支|branch|commit|历史|语言|cookie|密码|账号|用户|git|名称|项目|任务|地址)/i.test(line)) {
    return false
  }
  // 含中文，或短英文项目名
  return /[\u4e00-\u9fff]/.test(line) || (/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,40}$/.test(line) && line.length <= 32)
}

function pickLabeledValue(text, labels, { allowSpace = false } = {}) {
  const joined = labels.map(esc).join('|')
  const valuePart = allowSpace ? '([^\\n\\r]+?)' : '([^\\s，,;；\\n\\r]+)'
  const re = new RegExp(
    `(?:^|[\\s\\n\\r|｜])(?:${joined})\\s*[:：=]?\\s*${valuePart}(?=$|[\\s，,;；\\n\\r|｜])`,
    'im',
  )
  const m = text.match(re)
  if (!m) return ''
  return m[1].trim().replace(/^["'`「『]|["'`」』]$/g, '')
}

/** 从 Git 托管浏览 URL 拆分支 / commit / 裸仓 */
function extractFromHostingUrl(text, bag) {
  // GitLab: http://host/group/repo/-/tree/branch[/...]
  //         .../-/commit/sha
  //         .../-/commits/branch
  const gitlabTree = text.match(
    /(https?:\/\/[^\s"'<>]+?)\/-\/tree\/([^/\s"'<>]+)(?:\/[^\s"'<>]*)?/i,
  )
  if (gitlabTree) {
    scorePick(bag, 'projectUrl', cleanUrl(`${gitlabTree[1]}.git`.replace(/\.git\.git$/i, '.git')), 92, 'GitLab tree 链接')
    scorePick(bag, 'targetBranch', stripOrigin(decodeURIComponent(gitlabTree[2])), 90, '链接 path /tree/')
  }

  const gitlabCommit = text.match(
    /(https?:\/\/[^\s"'<>]+?)\/-\/commits?\/([0-9a-f]{7,40})\b/i,
  )
  if (gitlabCommit) {
    scorePick(bag, 'projectUrl', cleanUrl(gitlabCommit[1]), 92, 'GitLab commit 链接')
    scorePick(bag, 'commitId', gitlabCommit[2].toLowerCase(), 95, '链接 path /commit/')
  }

  const gitlabCommitsBranch = text.match(
    /(https?:\/\/[^\s"'<>]+?)\/-\/commits\/(?![0-9a-f]{7,40}\b)([^/\s"'<>]+)/i,
  )
  if (gitlabCommitsBranch) {
    scorePick(bag, 'projectUrl', cleanUrl(gitlabCommitsBranch[1]), 88, 'GitLab commits 链接')
    scorePick(bag, 'targetBranch', stripOrigin(decodeURIComponent(gitlabCommitsBranch[2])), 85, '链接 /commits/分支')
  }

  // GitHub / Gitee 风格: .../tree/branch  .../commit/sha  .../blob/branch/...
  const ghTree = text.match(
    /(https?:\/\/[^\s"'<>]+?)\/(?:tree|blob)\/([^/\s"'<>]+)(?:\/[^\s"'<>]*)?/i,
  )
  if (ghTree && !/\/-\//.test(ghTree[0])) {
    scorePick(bag, 'projectUrl', cleanUrl(ghTree[1]), 90, '托管 tree/blob 链接')
    const seg = decodeURIComponent(ghTree[2])
    if (COMMIT_RE.test(seg) && seg.length >= 7) {
      scorePick(bag, 'commitId', seg.toLowerCase(), 88, '链接中的 commit 段')
    } else if (BRANCH_NAME_RE.test(seg)) {
      scorePick(bag, 'targetBranch', stripOrigin(seg), 88, '链接 path /tree|blob/')
    }
  }

  const ghCommit = text.match(
    /(https?:\/\/[^\s"'<>]+?)\/commit\/([0-9a-f]{7,40})\b/i,
  )
  if (ghCommit && !/\/-\//.test(ghCommit[0])) {
    scorePick(bag, 'projectUrl', cleanUrl(ghCommit[1]), 90, '托管 commit 链接')
    scorePick(bag, 'commitId', ghCommit[2].toLowerCase(), 95, '链接 /commit/')
  }
}

function extractGitClone(text, bag) {
  // git clone [-b branch] [其它参数] <url>
  const cloneLine = text.match(/git\s+clone\s+([^\n]+)/i)
  if (cloneLine) {
    const args = cloneLine[1]
    const branch = args.match(/(?:^|\s)-b\s+([^\s]+)/i)?.[1]
    const url =
      args.match(/(https?:\/\/[^\s"'<>]+)/i)?.[1] ||
      args.match(/(git@[^\s"'<>]+?:[^\s"'<>]+)/i)?.[1]
    if (branch) scorePick(bag, 'targetBranch', stripOrigin(branch), 93, 'git clone -b')
    if (url) scorePick(bag, 'projectUrl', cleanUrl(url), 94, 'git clone 地址')
  }

  const checkout = text.match(
    /git\s+(?:checkout|switch)\s+(?:--track\s+)?(?:-b\s+)?(?:origin\/)?([A-Za-z0-9._/-]+)/i,
  )
  if (checkout && !COMMIT_RE.test(checkout[1])) {
    scorePick(bag, 'targetBranch', stripOrigin(checkout[1]), 80, 'git checkout/switch')
  }
}

function extractBareUrl(text, bag) {
  if (bag.projectUrl) return

  const http = text.match(/https?:\/\/[^\s"'<>]+/i)
  if (http) {
    let url = http[0]
    // 排除明显非 git 的扫描平台页
    if (!/10\.10\.107\.153|codeCheck|quickcheck/i.test(url)) {
      scorePick(bag, 'projectUrl', cleanUrl(url), 75, 'HTTP(S) 地址')
    }
  }

  if (!bag.projectUrl) {
    const ssh = text.match(/git@[^\s"'<>]+?:[^\s"'<>]+?(?:\.git)?/i)
    if (ssh) scorePick(bag, 'projectUrl', cleanUrl(ssh[0]), 78, 'SSH git 地址')
  }
}

function extractLabeled(text, bag) {
  const name = pickLabeledValue(
    text,
    ['项目名称', '项目名', '任务名称', '任务名', '名称', 'qkName', '应用名', '系统名'],
    { allowSpace: true },
  )
  if (name && !/^https?:/i.test(name) && !COMMIT_RE.test(name)) {
    // 允许中文名含空格时截到合理长度
    const trimmed = name.slice(0, 40).trim()
    scorePick(bag, 'qkName', trimmed, 88, '标签「名称」')
  }

  const branch = pickLabeledValue(text, [
    '目标分支',
    'gitBranchName',
    'targetBranch',
    '分支名',
    '分支',
    'branch',
    'ref',
  ])
  if (branch && BRANCH_NAME_RE.test(branch) && !/^https?:/i.test(branch)) {
    scorePick(bag, 'targetBranch', stripOrigin(branch), 90, '标签「分支」')
  }

  const commitLabels = pickLabeledValue(text, [
    '历史id',
    '历史ID',
    'commitId',
    'commit id',
    'CommitID',
    'COMMIT',
    'commit',
    '提交id',
    '提交ID',
    '提交哈希',
    '哈希',
    'hash',
    'sha',
    'revision',
  ])
  if (commitLabels && COMMIT_RE.test(commitLabels)) {
    scorePick(bag, 'commitId', commitLabels.toLowerCase(), 92, '标签「Commit」')
  }

  const urlLabeled = pickLabeledValue(text, [
    '项目地址',
    '仓库地址',
    '仓库',
    'git地址',
    'Git地址',
    'svnGitUri',
    'repo',
    'repository',
    'clone',
    '地址',
  ])
  if (urlLabeled && (/^https?:\/\//i.test(urlLabeled) || /^git@/i.test(urlLabeled))) {
    scorePick(bag, 'projectUrl', cleanUrl(urlLabeled), 91, '标签「地址」')
  }

  const user = pickLabeledValue(text, [
    'Git名称',
    'git名称',
    'svnGitUserName',
    'git用户',
    '用户名',
    'username',
    '账号',
    '帐号',
  ])
  if (user && !/密码|password|cookie/i.test(user)) {
    scorePick(bag, 'gitUsername', user, 85, '标签「用户名」')
  }

  const pass = pickLabeledValue(text, ['Git密码', 'git密码', 'svnGitPwd', '密码', 'password', '口令', 'pwd'])
  if (pass && !/XSRF|JSESSIONID/i.test(pass) && pass.length < 200) {
    scorePick(bag, 'gitPassword', pass, 85, '标签「密码」')
  }

  const langLabeled = text.match(
    /(?:语言|language|lang)\s*[=:]?\s*(\d{1,2}|JS\/?TS|Java(?:\s*\(Android\))?|Python|Go|Kotlin|Swift|PHP|C\/C\+\+|C#|Ruby)/i,
  )
  if (langLabeled) {
    const v = langLabeled[1]
    let num = null
    if (/^\d+$/.test(v)) num = Number(v)
    else if (/js/i.test(v)) num = 9
    else if (/android/i.test(v)) num = 7
    else if (/java/i.test(v)) num = 0
    else if (/python/i.test(v)) num = 3
    else if (/go/i.test(v)) num = 12
    else if (/kotlin/i.test(v)) num = 16
    else if (/swift/i.test(v)) num = 15
    else if (/php/i.test(v)) num = 4
    else if (/c#/i.test(v)) num = 2
    else if (/c\+\+|c\s*\/\s*c/i.test(v)) num = 1
    else if (/ruby/i.test(v)) num = 13
    if (num != null) scorePick(bag, 'language', num, 90, '标签「语言」')
  }
}

function extractBareCommit(text, bag) {
  if (bag.commitId) return
  const full = text.match(FULL_COMMIT_RE)
  if (full) {
    scorePick(bag, 'commitId', full[1].toLowerCase(), 70, '40 位哈希')
    return
  }
  // 独立一行的短 hash（≥8，降低误伤）
  const lines = text.split('\n').map((l) => l.trim())
  for (const line of lines) {
    if (/^[0-9a-f]{8,39}$/i.test(line)) {
      scorePick(bag, 'commitId', line.toLowerCase(), 55, '独立短哈希行')
      return
    }
  }
}

function extractRefsHeads(text, bag) {
  const ref = text.match(/refs\/heads\/([A-Za-z0-9._/-]+)/)
  if (ref) scorePick(bag, 'targetBranch', stripOrigin(ref[1]), 86, 'refs/heads/')
}

function extractNameFromLines(text, bag, projectUrl) {
  if (bag.qkName) return

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    // 跳过已是键值的行
    if (/^(https?:|git@)/i.test(line)) continue
    if (COMMIT_RE.test(line)) continue
    if (/[/:]/.test(line) && /分支|branch|commit|历史|语言|密码|cookie|地址/i.test(line)) continue
    if (looksLikeCnTitle(line)) {
      const cleaned = line.replace(/^(名称|项目|任务)\s*[=:]\s*/, '').trim()
      scorePick(bag, 'qkName', cleaned, 62, '标题行')
      return
    }
  }

  const slug = repoSlug(projectUrl || bag.projectUrl?.value)
  if (slug) {
    // 中文场景更偏好保留 slug；若全是英文下划线则 humanize 仅作弱提示
    const prefer = /[\u4e00-\u9fff]/.test(slug) ? slug : slug.replace(/\.git$/i, '')
    scorePick(bag, 'qkName', prefer, 40, '由仓库名推断')
  }
}

function inferLanguage(text, bag) {
  if (bag.language) return

  for (const item of LANG_FROM_TEXT) {
    if (item.re.test(text)) {
      scorePick(bag, 'language', item.value, 58, item.why)
      return
    }
  }

  const url = bag.projectUrl?.value || ''
  const name = bag.qkName?.value || ''
  const hay = `${url} ${name}`
  for (const item of LANG_FROM_PATH) {
    if (item.re.test(hay)) {
      scorePick(bag, 'language', item.value, 45, '由仓库路径/名称推断')
      return
    }
  }
}

function toResult(bag, cookie) {
  const matched = []
  const details = {}
  const result = { matched, details }

  const order = [
    'qkName',
    'projectUrl',
    'targetBranch',
    'commitId',
    'language',
    'gitUsername',
    'gitPassword',
    'cookie',
  ]

  if (cookie) {
    bag.cookie = { value: cookie, confidence: 95, source: '粘贴中的会话 Cookie' }
  }

  for (const key of order) {
    const hit = bag[key]
    if (!hit) continue
    result[key] = hit.value
    details[key] = { confidence: hit.confidence, source: hit.source }
    matched.push(FIELD_LABELS[key] || key)
  }

  if (result.qkName && !result.taskName) {
    result.taskName = `${result.qkName}-gp`
  }

  // 置信摘要：便于 UI 展示「依据」
  result.hints = order
    .filter((k) => details[k])
    .map((k) => ({
      field: k,
      label: FIELD_LABELS[k],
      value: String(result[k]),
      confidence: details[k].confidence,
      source: details[k].source,
    }))

  return result
}

/**
 * @param {string} raw
 * @returns {object}
 */
export function parseScanPaste(raw) {
  const normalized = normalizeRaw(raw)
  if (!normalized) return { matched: [], hints: [] }

  const { cookie, rest } = extractCookie(normalized)
  const text = rest.trim()
  const bag = {}

  extractFromHostingUrl(text, bag)
  extractGitClone(text, bag)
  extractLabeled(text, bag)
  extractBareUrl(text, bag)
  extractRefsHeads(text, bag)
  extractBareCommit(text, bag)
  extractNameFromLines(text, bag, bag.projectUrl?.value)
  inferLanguage(text, bag)

  // 交叉校验：分支不能是完整 commit；名称不能是 url
  if (bag.targetBranch && COMMIT_RE.test(bag.targetBranch.value) && bag.targetBranch.value.length >= 36) {
    if (!bag.commitId || bag.commitId.confidence < bag.targetBranch.confidence) {
      scorePick(bag, 'commitId', bag.targetBranch.value.toLowerCase(), bag.targetBranch.confidence, '分支字段实为 Commit')
    }
    delete bag.targetBranch
  }
  if (bag.qkName && /^https?:/i.test(bag.qkName.value)) {
    delete bag.qkName
  }

  return toResult(bag, cookie)
}

export { FIELD_LABELS }

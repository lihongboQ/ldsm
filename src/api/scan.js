import {
  SCAN_API_PATH,
  SCAN_LIST_API_PATH,
  LANGUAGE_API_PATH,
  REPORT_EXPORT_API_PATH,
  REPORT_LIST_API_PATH,
  BRANCH_API_PATH,
  RULE_CODE_API_PATH,
  RESULT_TYPES_API_PREFIX,
  BUG_TYPES_API_PREFIX,
  buildCheckPayload,
  buildReportExportPayload,
  extractXsrfToken,
} from '../constants/scan'

function authHeaders(cookie) {
  const value = String(cookie || '').trim()
  const xsrf = extractXsrfToken(value)
  return {
    Accept: 'application/json, text/plain, */*',
    'X-Scan-Cookie': value,
    ...(xsrf
      ? {
          'X-XSRF-TOKEN': xsrf,
          'X-Scan-Xsrf': xsrf,
        }
      : {}),
  }
}

async function parseResponse(response) {
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!response.ok) {
    const message =
      data?.retInfo || data?.message || data?.msg || data?.raw || `HTTP ${response.status}`
    throw new Error(message)
  }

  if (data && typeof data === 'object' && data.retCode && data.retCode !== '000') {
    throw new Error(data.retInfo || data.message || data.msg || `业务错误 ${data.retCode}`)
  }

  return data
}

/**
 * 发起漏洞扫描
 * Content-Type: application/x-www-form-urlencoded
 * body: data=<JSON>
 */
export async function submitQuickCheck(form) {
  const cookie = form.cookie.trim()
  const payload = buildCheckPayload(form)

  const body = new URLSearchParams()
  body.set('data', JSON.stringify(payload))

  const response = await fetch(SCAN_API_PATH, {
    method: 'POST',
    headers: {
      ...authHeaders(cookie),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  return parseResponse(response)
}

/**
 * 获取漏扫任务列表
 * Content-Type: application/x-www-form-urlencoded
 * body: data={"page":{"checkType":0,"pageSize":15,"pageIndex":1}}
 */
export async function fetchQuickCheckList(cookie, page = {}) {
  const payload = {
    page: {
      checkType: page.checkType ?? 0,
      pageSize: page.pageSize ?? 15,
      pageIndex: page.pageIndex ?? 1,
    },
  }

  const body = new URLSearchParams()
  body.set('data', JSON.stringify(payload))

  const response = await fetch(SCAN_LIST_API_PATH, {
    method: 'POST',
    headers: {
      ...authHeaders(cookie),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  return parseResponse(response)
}

/** 获取语言 / 引擎列表 */
export async function fetchLanguageEngines(cookie) {
  const response = await fetch(LANGUAGE_API_PATH, {
    method: 'GET',
    headers: authHeaders(cookie),
  })

  return parseResponse(response)
}

/**
 * 拉取 Git 全部分支
 * POST /api/v1/rest/getAllBranch
 */
export async function fetchGitBranches(cookie, { url, username, password, connectTypeIndex = 0 }) {
  const response = await fetch(BRANCH_API_PATH, {
    method: 'POST',
    headers: {
      ...authHeaders(cookie),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: String(url || '').trim(),
      connectTypeIndex,
      username: String(username || '').trim(),
      password: String(password || ''),
    }),
  })

  return parseResponse(response)
}

export function normalizeBranchOptions(payload) {
  const list =
    payload?.data?.branchs ||
    payload?.data?.branches ||
    payload?.branchs ||
    payload?.branches ||
    []

  if (!Array.isArray(list)) return []
  return list.map((item) => String(item)).filter(Boolean)
}

/**
 * 从引擎接口响应中尽量抽出语言选项。
 * 结构因现场版本可能不同，做多层兜底。
 */
export function normalizeLanguageOptions(payload) {
  const buckets = []

  if (Array.isArray(payload)) buckets.push(payload)
  if (Array.isArray(payload?.data)) buckets.push(payload.data)
  if (Array.isArray(payload?.data?.list)) buckets.push(payload.data.list)
  if (Array.isArray(payload?.data?.rows)) buckets.push(payload.data.rows)
  if (Array.isArray(payload?.list)) buckets.push(payload.list)
  if (Array.isArray(payload?.rows)) buckets.push(payload.rows)
  if (Array.isArray(payload?.engines)) buckets.push(payload.engines)
  if (Array.isArray(payload?.data?.engines)) buckets.push(payload.data.engines)

  // 对象字典：{ "9": "JavaScript", ... }
  if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === 'object') {
    const entries = Object.entries(payload.data)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([k, v]) => ({ value: Number.isNaN(Number(k)) ? k : Number(k), label: String(v) }))
    if (entries.length) return entries
  }

  for (const list of buckets) {
    const options = list
      .map((item) => {
        if (item == null) return null
        if (typeof item !== 'object') {
          return { value: item, label: String(item) }
        }
        const value =
          item.language ??
          item.lang ??
          item.code ??
          item.id ??
          item.pk ??
          item.value ??
          item.key ??
          item.type
        const label =
          item.languageName ??
          item.langName ??
          item.name ??
          item.label ??
          item.text ??
          item.title ??
          item.desc ??
          item.engineName ??
          (value != null ? String(value) : '')
        if (value == null || label === '') return null
        return { value, label: String(label), raw: item }
      })
      .filter(Boolean)

    if (options.length) return options
  }

  return []
}

/** 从列表接口抽出行数据（现场字段为 data.quickVOS） */
export function normalizeListRows(payload) {
  const candidates = [
    payload?.data?.quickVOS,
    payload?.data?.quickVOs,
    payload?.data?.list,
    payload?.data?.rows,
    payload?.data?.records,
    payload?.data?.page?.list,
    payload?.data?.page?.rows,
    payload?.list,
    payload?.rows,
  ]

  for (const item of candidates) {
    if (Array.isArray(item)) return item
  }

  return []
}

export function normalizeListTotal(payload) {
  return (
    payload?.data?.totalCount ??
    payload?.data?.total ??
    payload?.totalCount ??
    0
  )
}

/** 任务状态文案 */
export function taskStatusText(status) {
  const map = {
    0: '待检测',
    1: '检测中',
    2: '已完成',
    3: '失败',
    4: '已停止',
  }
  return map[status] ?? `状态${status ?? '-'}`
}

/**
 * 按语言编号查询规则模板
 * POST /api/v1/rule/queryRuleCodeByRefNames  body: data=<language>
 */
export async function fetchRuleCodesByLanguage(cookie, language) {
  const body = new URLSearchParams()
  body.set('data', String(language))

  const response = await fetch(RULE_CODE_API_PATH, {
    method: 'POST',
    headers: {
      ...authHeaders(cookie),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  return parseResponse(response)
}

/**
 * 查询任务实际命中的缺陷类型/规则（平台 getBugTypes）
 * GET /api/v1/rest/result/{pkTask}/types
 * 回退 GET /api/v1/result/bugTypes/{pkTask}
 */
export async function fetchHitRuleCodes(cookie, pkTask) {
  const id = encodeURIComponent(pkTask)
  const urls = [
    `${RESULT_TYPES_API_PREFIX}/${id}/types`,
    `${BUG_TYPES_API_PREFIX}/${id}`,
    `${BUG_TYPES_API_PREFIX}/${id}/`,
  ]

  let lastError = null
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: authHeaders(cookie),
      })
      const data = await parseResponse(response)
      const codes = normalizeHitRuleCodes(data)
      if (codes.length) return codes
    } catch (err) {
      lastError = err
    }
  }

  if (lastError) throw lastError
  return []
}

/** 把 queryRuleCodeByRefNames 返回的分组规则拍平成去重数组 */
export function normalizeRuleCodeList(payload) {
  const data = payload?.data
  const codes = []

  if (Array.isArray(data)) {
    codes.push(...data)
  } else if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) codes.push(...value)
      else if (typeof value === 'string') codes.push(value)
    }
  }

  return [...new Set(codes.map(String).filter(Boolean))]
}

/**
 * 解析任务命中规则接口。
 * 平台结构：data[{ typeName, sons:[{ ruleCode, sons:[...] }] }]
 * 注意：leaf 上 num/high/medium/low 常为 0，不能靠数量过滤，应收集全部 ruleCode。
 */
export function normalizeHitRuleCodes(payload) {
  const codes = []

  const walk = (item) => {
    if (item == null) return
    if (typeof item === 'string' || typeof item === 'number') {
      codes.push(String(item))
      return
    }
    if (typeof item !== 'object') return

    const value =
      item.ruleCode ??
      item.code ??
      item.bugType ??
      item.typeCode ??
      item.ruleId ??
      null
    if (value != null && value !== '') codes.push(String(value))

    if (Array.isArray(item.ruleCodeList)) item.ruleCodeList.forEach(walk)
    if (Array.isArray(item.codes)) item.codes.forEach(walk)
    // 平台字段是 sons（不是 children）
    if (Array.isArray(item.sons)) item.sons.forEach(walk)
    if (Array.isArray(item.children)) item.children.forEach(walk)
    if (Array.isArray(item.nodes)) item.nodes.forEach(walk)
  }

  const data = payload?.data ?? payload
  if (Array.isArray(data)) data.forEach(walk)
  else walk(data)

  return [...new Set(codes.filter(Boolean))]
}

/**
 * 生成任务报告：
 * 1) 必须用任务命中规则 /rest/result/{pkTask}/types（与列表 高/中/低 对齐）
 * 2) 仅当命中规则为空时，才回退语言模板
 * 3) newAuditStatus 必须含 1 和 3；只传 [1] 会生成空报告
 */
export async function createTaskReport(
  cookie,
  { reportName, pkTask, ruleCodeList, language },
) {
  let codes = Array.isArray(ruleCodeList) ? ruleCodeList.filter(Boolean) : []
  let source = codes.length ? 'given' : ''

  if (!codes.length) {
    codes = await fetchHitRuleCodes(cookie, pkTask)
    if (codes.length) source = 'hit'
  }

  if (!codes.length) {
    const lang = language == null || language === '' ? null : Number(language)
    if (lang == null || Number.isNaN(lang)) {
      throw new Error('无法生成报告：未取到命中规则，且缺少语言编号')
    }
    const rulePayload = await fetchRuleCodesByLanguage(cookie, lang)
    codes = normalizeRuleCodeList(rulePayload)
    source = 'language'
  }

  if (!codes.length) {
    throw new Error('未查询到可用的 ruleCodeList')
  }

  const payload = buildReportExportPayload({
    reportName,
    pkTask,
    ruleCodeList: codes,
  })
  const response = await fetch(REPORT_EXPORT_API_PATH, {
    method: 'POST',
    headers: {
      ...authHeaders(cookie),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const result = await parseResponse(response)
  if (result && typeof result === 'object') {
    result._ruleSource = source
    result._ruleCount = codes.length
  }
  return result
}

/** 报告列表 */
export async function fetchReportList(cookie, { size = 15, index = 1 } = {}) {
  const url = `${REPORT_LIST_API_PATH}?size=${encodeURIComponent(size)}&index=${encodeURIComponent(index)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: authHeaders(cookie),
  })
  return parseResponse(response)
}

export function normalizeReportRows(payload) {
  const candidates = [
    payload?.data?.list,
    payload?.data?.rows,
    payload?.data?.records,
    payload?.list,
    payload?.rows,
  ]
  for (const item of candidates) {
    if (Array.isArray(item)) return item
  }
  return []
}

export function normalizeReportTotal(payload) {
  return payload?.data?.total ?? payload?.data?.totalCount ?? payload?.total ?? 0
}

function parseContentDispositionFileName(disposition) {
  if (!disposition) return ''
  const star = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      return star[1].trim()
    }
  }
  const plain = disposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i)
  if (!plain) return ''
  const raw = (plain[1] || plain[2] || '').trim()
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 下载报告文件（arrayBuffer → blob，避免过早 revoke 导致空文件） */
export async function downloadReportFile(cookie, pkReport, fileName) {
  const value = String(cookie || '').trim()
  const xsrf = extractXsrfToken(value)

  const response = await fetch(`${REPORT_LIST_API_PATH}/${encodeURIComponent(pkReport)}/download`, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'X-Scan-Cookie': value,
      ...(xsrf
        ? {
            'X-XSRF-TOKEN': xsrf,
            'X-Scan-Xsrf': xsrf,
          }
        : {}),
    },
  })

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // 业务错误常以 JSON 返回
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 80))).trim()
  if (head.startsWith('{') || head.startsWith('<')) {
    let message = `下载失败（HTTP ${response.status}）`
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes))
      message = data?.retInfo || data?.message || data?.msg || message
    } catch {
      if (head.startsWith('<')) message = '下载失败：返回了登录页或 HTML，请检查 Cookie'
    }
    throw new Error(message)
  }

  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }

  if (!bytes.length) {
    throw new Error('下载失败：文件内容为空')
  }

  // docx/xlsx/zip 通常以 PK 开头
  const looksZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!looksZip) {
    throw new Error('下载失败：文件格式异常（非有效报告包）')
  }

  const disposition = response.headers.get('content-disposition') || ''
  const name =
    parseContentDispositionFileName(disposition) ||
    fileName ||
    `report-${pkReport}.docx`

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 延迟释放，避免部分浏览器下到 0 字节空文件
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

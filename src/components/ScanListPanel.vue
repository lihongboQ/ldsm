<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  createTaskReport,
  fetchQuickCheckList,
  normalizeListRows,
  normalizeListTotal,
} from '../api/scan'
import { LANGUAGES } from '../constants/scan'
import { saveCookieSession } from '../utils/cookieSession'

const props = defineProps({
  cookie: { type: String, default: '' },
})

const loading = ref(false)
const error = ref('')
const actionMsg = ref('')
const raw = ref(null)
const pageIndex = ref(1)
const pageSize = 15
const selected = ref(new Set())
const creatingPk = ref(null)
let pollTimer = null

const rows = computed(() => normalizeListRows(raw.value))
const total = computed(() => normalizeListTotal(raw.value))
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value) / pageSize) || 1))

const languageMap = Object.fromEntries(LANGUAGES.map((item) => [String(item.value), item.label]))

const SOURCE_MAP = {
  0: '本地上传',
  1: 'SVN',
  2: 'Git',
  3: 'TFS',
}

async function loadList({ silent = false } = {}) {
  if (!props.cookie.trim()) {
    if (!silent) error.value = '请先填写 Cookie'
    return
  }

  if (!silent) {
    error.value = ''
    loading.value = true
  }

  try {
    raw.value = await fetchQuickCheckList(props.cookie, {
      checkType: 0,
      pageSize,
      pageIndex: pageIndex.value,
    })
    if (!silent) selected.value = new Set()
  } catch (err) {
    if (!silent) {
      error.value = err?.message || '列表加载失败'
      raw.value = null
    }
  } finally {
    if (!silent) loading.value = false
  }
}

function task(row) {
  return row?.taskVO || {}
}

function tool(row) {
  const list = task(row).taskToolVOs
  return Array.isArray(list) && list.length ? list[0] : {}
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return 0
}

function counts(row) {
  const t = task(row)
  const tt = tool(row)
  const high = Number(pick(t.problemNum5, tt.problemNum5, 0))
  const mid = Number(pick(t.problemNum3, tt.problemNum3, 0))
  const low = Number(pick(t.problemNum1, tt.problemNum1, 0))
  const all = Number(pick(t.problemNum, tt.problemNum, high + mid + low))
  return { high, mid, low, all }
}

function rowNum(row) {
  return Number(pick(task(row).rowNum, tool(row).rowNum, 0))
}

function title(row) {
  return task(row).taskName || row.qkName || `任务 #${row.pkQuick ?? row.id}`
}

function statusText(row) {
  const status = task(row).taskStatus
  const desc = task(row).taskResultDesc || ''
  if (status === 2) return desc.includes('成功') || !desc ? '检测成功' : desc.replace(/^\[Sky\]/, '')
  if (status === 1) return '检测中'
  if (status === 3) return desc || '检测失败'
  if (status === 0) return '待检测'
  if (status === 4) return '已停止'
  return desc || `状态 ${status ?? '-'}`
}

function statusClass(row) {
  const status = task(row).taskStatus
  if (status === 2) return 'text-[#52c41a]'
  if (status === 1) return 'text-[#1677ff]'
  if (status === 3) return 'text-[#ff4d4f]'
  return 'text-ink-muted'
}

function languageLabel(row) {
  const code = task(row).language
  if (code == null) return '—'
  return languageMap[String(code)] || `语言${code}`
}

function sourceLabel(row) {
  const code = pick(task(row).getCodeType, row.source, 0)
  return SOURCE_MAP[code] || `来源${code}`
}

function sourceUrl(row) {
  return (
    task(row).svnGitUri ||
    task(row).gitUri ||
    task(row).savePath ||
    row.taskDesc ||
    ''
  )
}

function branchLabel(row) {
  return task(row).gitBranchName || task(row).branch || '—'
}

function timeRange(row) {
  const begin = task(row).taskBeginTime || row.createTime
  const end = task(row).taskEndTime
  if (begin && end) return `${begin} 至 ${end}`
  if (begin) return begin
  return '—'
}

function detailUrl(row) {
  const pk = row.pkQuick ?? row.id
  return `https://10.10.107.153/#/codeCheck/code-check-list?pkQuick=${pk}`
}

function toggleSelect(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}

async function prevPage() {
  if (pageIndex.value <= 1) return
  pageIndex.value -= 1
  await loadList()
}

async function nextPage() {
  if (pageIndex.value >= totalPages.value) return
  pageIndex.value += 1
  await loadList()
}

function openReportListTab() {
  saveCookieSession(props.cookie)
  window.open(`${window.location.origin}${window.location.pathname}#/reports`, '_blank')
}

async function onGenerateReport(row) {
  actionMsg.value = ''
  error.value = ''

  if (!props.cookie.trim()) {
    error.value = '请先填写 Cookie'
    return
  }

  const pkTask = task(row).pkTask
  if (!pkTask) {
    error.value = '缺少 pkTask，无法生成报告'
    return
  }

  if (task(row).taskStatus !== 2) {
    error.value = '仅检测成功的任务可生成报告'
    return
  }

  // 平台语言：0=Java 也是有效值，不能当成空
  const rawLang = task(row).language ?? tool(row).language
  const language =
    rawLang === '' || rawLang == null || Number.isNaN(Number(rawLang))
      ? null
      : Number(rawLang)

  creatingPk.value = pkTask
  try {
    const data = await createTaskReport(props.cookie, {
      reportName: title(row),
      pkTask,
      language,
    })
    const pkReport = data?.data?.pkReport
    const ruleHint =
      data?._ruleSource === 'hit'
        ? `命中规则${data._ruleCount}条`
        : data?._ruleSource === 'language'
          ? `语言模板${data._ruleCount}条`
          : `规则${data?._ruleCount || ''}`
    actionMsg.value = pkReport
      ? `已提交报告生成：${title(row)}（报告 #${pkReport}，${ruleHint}）`
      : `已提交报告生成：${title(row)}（${ruleHint}）`
    openReportListTab()
  } catch (err) {
    error.value = err?.message || '生成报告失败'
  } finally {
    creatingPk.value = null
  }
}

onMounted(() => {
  loadList()
  pollTimer = window.setInterval(() => {
    loadList({ silent: true })
  }, 5000)
})

onUnmounted(() => {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
})

defineExpose({ loadList })
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">漏扫任务列表</h2>
        <p class="mt-1 text-sm text-ink-muted">
          共 {{ total }} 条 · 每 5 秒自动刷新
          <span v-if="loading"> · 加载中…</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-secondary" :disabled="loading || pageIndex <= 1" @click="prevPage">
          上一页
        </button>
        <span class="text-sm text-ink-muted">{{ pageIndex }} / {{ totalPages }}</span>
        <button
          type="button"
          class="btn-secondary"
          :disabled="loading || pageIndex >= totalPages"
          @click="nextPage"
        >
          下一页
        </button>
        <button type="button" class="btn-primary" :disabled="loading" @click="loadList">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <p v-if="actionMsg" class="text-sm text-accent">{{ actionMsg }}</p>

    <div v-if="!rows.length && !loading" class="rounded-xl border border-line bg-white px-4 py-10 text-center text-sm text-ink-muted">
      暂无数据
    </div>

    <article
      v-for="(row, index) in rows"
      :key="row.pkQuick ?? row.id ?? index"
      class="rounded-lg border border-[#e8e8e8] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      <!-- 第一行：标题 + 操作 -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <label class="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 accent-[#1677ff]"
            :checked="selected.has(row.pkQuick ?? row.id)"
            @change="toggleSelect(row.pkQuick ?? row.id)"
          />
          <a
            class="min-w-0 text-[15px] font-medium text-[#1677ff] hover:underline"
            :href="detailUrl(row)"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ title(row) }}
            <span class="font-normal text-ink-muted">
              （总行数: {{ formatNum(rowNum(row)) }} 行）
            </span>
          </a>
        </label>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#1677ff]">
          <a :href="detailUrl(row)" target="_blank" rel="noopener noreferrer" class="hover:underline">查看结果</a>
          <a :href="detailUrl(row)" target="_blank" rel="noopener noreferrer" class="hover:underline">缺陷审计</a>
          <button
            type="button"
            class="hover:underline disabled:cursor-not-allowed disabled:text-[#bfbfbf]"
            :disabled="task(row).taskStatus !== 2 || creatingPk === task(row).pkTask"
            @click="onGenerateReport(row)"
          >
            {{ creatingPk === task(row).pkTask ? '生成中…' : '生成报告' }}
          </button>
          <a :href="detailUrl(row)" target="_blank" rel="noopener noreferrer" class="hover:underline">修改权限</a>
          <span
            class="cursor-default"
            :class="task(row).taskStatus === 2 ? 'text-[#1677ff] hover:underline cursor-pointer' : 'text-[#bfbfbf]'"
          >
            重新发起
          </span>
          <a :href="detailUrl(row)" target="_blank" rel="noopener noreferrer" class="hover:underline">下载日志</a>
        </div>
      </div>

      <!-- 第二行：状态 + 缺陷徽章 -->
      <div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="text-ink-muted">检测状态</span>
          <span class="font-medium" :class="statusClass(row)">{{ statusText(row) }}</span>
        </div>

        <div
          class="group relative flex flex-wrap items-center gap-2"
          :title="`高: ${counts(row).high} | 中: ${counts(row).mid} | 低: ${counts(row).low} | 总: ${counts(row).all}`"
        >
          <span class="text-ink-muted">缺陷检测</span>

          <span class="badge badge-high" title="高危">
            <span class="badge-icon">▲</span> 高 {{ counts(row).high }}
          </span>
          <span class="badge badge-mid" title="中危">
            <span class="badge-icon">●</span> 中 {{ counts(row).mid }}
          </span>
          <span class="badge badge-low" title="低危">
            <span class="badge-icon">◆</span> 低 {{ counts(row).low }}
          </span>
          <span class="badge badge-all" title="总数">
            <span class="badge-icon">■</span> 总 {{ counts(row).all }}
          </span>

          <div
            class="pointer-events-none absolute -top-9 left-16 z-10 hidden whitespace-nowrap rounded bg-black/85 px-2 py-1 text-xs text-white group-hover:block"
          >
            高: {{ counts(row).high }} | 中: {{ counts(row).mid }} | 低: {{ counts(row).low }} | 总: {{ counts(row).all }}
          </div>
        </div>
      </div>

      <!-- 第三行：元信息 -->
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#8c8c8c]">
        <span>所属部门: {{ row.orgName || '—' }}</span>
        <span>{{ row.userName || task(row).creatorName || '—' }} 创建于: {{ row.createTime || '—' }}</span>
        <span>检测语言: {{ languageLabel(row) }}</span>
        <span class="inline-flex max-w-full items-center gap-1">
          源代码来源: {{ sourceLabel(row) }}
          <span
            v-if="sourceUrl(row)"
            class="inline-flex max-w-[14rem] items-center gap-1 truncate text-[#595959]"
            :title="sourceUrl(row)"
          >
            <span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-[#f5222d] text-[9px] font-bold text-white">
              {{ sourceLabel(row) === 'Git' ? 'G' : 'Z' }}
            </span>
            <span class="truncate">{{ sourceUrl(row) }}</span>
          </span>
        </span>
        <span>分支: {{ branchLabel(row) }}</span>
        <span>检测时间: {{ timeRange(row) }}</span>
      </div>
    </article>
  </section>
</template>

<style scoped>
@reference "../style.css";

.btn-primary {
  @apply inline-flex items-center justify-center rounded-lg bg-[#1677ff] px-4 py-2 text-sm font-medium text-white transition;
  @apply hover:bg-[#4096ff] disabled:cursor-not-allowed disabled:opacity-60;
}

.btn-secondary {
  @apply inline-flex items-center justify-center rounded-lg border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-ink transition;
  @apply hover:border-[#1677ff] hover:text-[#1677ff] disabled:cursor-not-allowed disabled:opacity-60;
}

.badge {
  @apply inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium;
}

.badge-icon {
  @apply text-[10px] leading-none;
}

.badge-high {
  @apply border-[#ffccc7] bg-[#fff1f0] text-[#cf1322];
}

.badge-mid {
  @apply border-[#ffd591] bg-[#fff7e6] text-[#d46b08];
}

.badge-low {
  @apply border-[#ffe58f] bg-[#fffbe6] text-[#d48806];
}

.badge-all {
  @apply border-[#d9d9d9] bg-[#fafafa] text-[#595959];
}
</style>

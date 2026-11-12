<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  downloadReportFile,
  fetchReportList,
  normalizeReportRows,
  normalizeReportTotal,
} from '../api/scan'
import { loadCookieSession } from '../utils/cookieSession'

const cookie = ref(loadCookieSession())
const loading = ref(false)
const error = ref('')
const raw = ref(null)
const pageIndex = ref(1)
const pageSize = 15
const downloadingId = ref(null)
let pollTimer = null

/**
 * 平台 reportStatus（按实际返回）：
 * 0 已完成可下载 / 2 生成中 / 1 或其他视为异常
 */
const STATUS = {
  DONE: 0,
  GENERATING: 2,
  FAILED: 1,
}

const rows = computed(() => normalizeReportRows(raw.value))
const total = computed(() => normalizeReportTotal(raw.value))
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value) / pageSize) || 1))
const generatingCount = computed(
  () => rows.value.filter((row) => Number(row.reportStatus) === STATUS.GENERATING).length,
)

async function loadList({ silent = false } = {}) {
  if (!cookie.value.trim()) {
    if (!silent) error.value = '缺少 Cookie，请从主页填报区同步后再打开本页'
    return
  }

  if (!silent) {
    error.value = ''
    loading.value = true
  }

  try {
    raw.value = await fetchReportList(cookie.value, {
      size: pageSize,
      index: pageIndex.value,
    })
  } catch (err) {
    if (!silent) {
      error.value = err?.message || '报告列表加载失败'
      raw.value = null
    }
  } finally {
    if (!silent) loading.value = false
  }
}

function statusOf(row) {
  return Number(row?.reportStatus)
}

function isGenerating(row) {
  return statusOf(row) === STATUS.GENERATING
}

function isDone(row) {
  return statusOf(row) === STATUS.DONE
}

function isFailed(row) {
  return statusOf(row) === STATUS.FAILED
}

function statusText(row) {
  if (isGenerating(row)) return '生成中'
  if (isDone(row)) return '已完成'
  if (isFailed(row)) return '失败'
  return `状态 ${row?.reportStatus ?? '-'}`
}

function statusClass(row) {
  if (isGenerating(row)) return 'bg-[#e6f4ff] text-[#1677ff] border-[#91caff]'
  if (isDone(row)) return 'bg-[#f6ffed] text-[#52c41a] border-[#b7eb8f]'
  if (isFailed(row)) return 'bg-[#fff2f0] text-[#ff4d4f] border-[#ffccc7]'
  return 'bg-surface text-ink-muted border-line'
}

function canDownload(row) {
  return isDone(row)
}

async function onDownload(row) {
  if (!canDownload(row) || downloadingId.value) return
  downloadingId.value = row.pkReport
  try {
    await downloadReportFile(
      cookie.value,
      row.pkReport,
      `${row.reportName || row.taskName || 'report'}.docx`,
    )
  } catch (err) {
    error.value = err?.message || '下载失败'
  } finally {
    downloadingId.value = null
  }
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
</script>

<template>
  <div class="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-sm font-medium tracking-wide text-accent">LDSM · report</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-ink">报告列表</h1>
          <p class="mt-2 text-sm text-ink-muted">
            共 {{ total }} 条 · 每 5 秒自动刷新
            <span v-if="generatingCount"> · 当前 {{ generatingCount }} 份生成中</span>
            <span v-if="loading"> · 加载中…</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <a href="#/" class="btn-secondary">返回填报</a>
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
          <button type="button" class="btn-primary" :disabled="loading" @click="loadList()">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
        </div>
      </header>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>

      <div class="overflow-x-auto rounded-xl border border-line bg-white">
        <table class="min-w-full border-collapse text-left text-sm">
          <thead class="bg-surface text-ink-muted">
            <tr>
              <th class="px-3 py-2.5 font-medium">报告名称</th>
              <th class="px-3 py-2.5 font-medium">任务</th>
              <th class="px-3 py-2.5 font-medium">状态</th>
              <th class="px-3 py-2.5 font-medium">导出人</th>
              <th class="px-3 py-2.5 font-medium">导出时间</th>
              <th class="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!rows.length && !loading">
              <td colspan="6" class="px-3 py-10 text-center text-ink-muted">暂无报告</td>
            </tr>
            <tr
              v-for="row in rows"
              :key="row.pkReport"
              class="border-t border-line align-top"
              :class="{ 'bg-[#f0f7ff]': isGenerating(row) }"
            >
              <td class="max-w-[18rem] px-3 py-3">
                <p class="font-medium text-ink">{{ row.reportName || '—' }}</p>
                <p class="mt-1 line-clamp-2 text-xs text-ink-muted">{{ row.reportDesc || '' }}</p>
              </td>
              <td class="px-3 py-3 text-ink">{{ row.taskName || row.codeName || '—' }}</td>
              <td class="px-3 py-3">
                <span
                  class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium"
                  :class="statusClass(row)"
                >
                  <span
                    v-if="isGenerating(row)"
                    class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#1677ff]"
                  />
                  {{ statusText(row) }}
                </span>
              </td>
              <td class="px-3 py-3 text-ink-muted">{{ row.userName || '—' }}</td>
              <td class="whitespace-nowrap px-3 py-3 font-mono text-xs text-ink-muted">
                {{ row.exportTime || '—' }}
              </td>
              <td class="px-3 py-3">
                <span v-if="isGenerating(row)" class="text-[#1677ff]">生成中…</span>
                <span v-else-if="isFailed(row)" class="text-[#ff4d4f]">不可下载</span>
                <button
                  v-else
                  type="button"
                  class="text-[#1677ff] hover:underline disabled:cursor-not-allowed disabled:text-[#bfbfbf]"
                  :disabled="!canDownload(row) || downloadingId === row.pkReport"
                  @click="onDownload(row)"
                >
                  {{ downloadingId === row.pkReport ? '下载中…' : '下载' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
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
</style>

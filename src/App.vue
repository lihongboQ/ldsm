<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ScanForm from './components/ScanForm.vue'
import ScanListPanel from './components/ScanListPanel.vue'
import ReportListPage from './components/ReportListPage.vue'
import { DEFAULT_TASK } from './constants/scan'
import { loadCookieSession, saveCookieSession } from './utils/cookieSession'

const cookie = ref(loadCookieSession() || DEFAULT_TASK.cookie)
const route = ref(window.location.hash || '#/')

function syncRoute() {
  route.value = window.location.hash || '#/'
}

const isReports = computed(() => route.value.startsWith('#/reports'))

watch(
  cookie,
  (value) => {
    saveCookieSession(value)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('hashchange', syncRoute)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', syncRoute)
})
</script>

<template>
  <ReportListPage v-if="isReports" />

  <div v-else class="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <p class="text-sm font-medium tracking-wide text-accent">LDSM · quickcheck</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          漏洞扫描任务
        </h1>
        <p class="mt-2 text-base text-ink-muted">
          先填报发起复扫；生成报告后会打开报告列表页下载。
          <a class="text-accent underline-offset-2 hover:underline" href="#/reports">打开报告列表</a>
        </p>
      </header>

      <ScanForm v-model:cookie="cookie" />
      <ScanListPanel :cookie="cookie" />
    </div>
  </div>
</template>

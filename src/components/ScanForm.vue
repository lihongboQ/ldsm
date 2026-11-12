<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import {
  fetchGitBranches,
  fetchLanguageEngines,
  normalizeBranchOptions,
  normalizeLanguageOptions,
  submitQuickCheck,
} from '../api/scan'
import { DEFAULT_TASK, LANGUAGES, PROJECT_PRESETS, SCAN_LIST_URL } from '../constants/scan'
import { loadFormMemory, saveFormMemory } from '../utils/formStorage'
import { parseScanPaste } from '../utils/parseScanPaste'

const props = defineProps({
  cookie: { type: String, default: '' },
})

const emit = defineEmits(['update:cookie'])

const saved = loadFormMemory()

function rememberedText(key, fallback = '') {
  const v = saved[key]
  return v == null || v === '' ? fallback : String(v)
}

function rememberedLanguage() {
  if (saved.language === '' || saved.language == null) return ''
  return saved.language
}

const form = reactive({
  assignee: rememberedText('assignee'),
  taskName: rememberedText('taskName'),
  qkName: rememberedText('qkName'),
  goal: rememberedText('goal'),
  language: rememberedLanguage(),
  gitUsername: rememberedText('gitUsername'),
  gitPassword: rememberedText('gitPassword'),
  projectUrl: rememberedText('projectUrl'),
  targetBranch: rememberedText('targetBranch'),
  commitId: rememberedText('commitId'),
  cookie: props.cookie || rememberedText('cookie', DEFAULT_TASK.cookie),
  isJ2ee: saved.isJ2ee != null && saved.isJ2ee !== '' ? saved.isJ2ee : DEFAULT_TASK.isJ2ee,
  jdkVersion:
    saved.jdkVersion === '' || saved.jdkVersion == null
      ? DEFAULT_TASK.jdkVersion
      : saved.jdkVersion,
  pkToolTemplate:
    saved.pkToolTemplate === '' || saved.pkToolTemplate == null
      ? DEFAULT_TASK.pkToolTemplate
      : saved.pkToolTemplate,
})

const errors = reactive({})
const submitting = ref(false)
const showPassword = ref(false)
const showCookie = ref(false)
const result = ref(null)
const submitError = ref('')
const memoryTip = ref('')
const pasteText = ref(rememberedText('pasteText'))
const pasteHint = ref('')
const pasteHints = ref([])

const languageOptions = ref([...LANGUAGES])
const languageLoading = ref(false)
const languageError = ref('')
const languageRaw = ref(null)

/** auto: 下拉选择；manual: 手填 */
const branchMode = ref(
  saved.branchMode === 'auto' || saved.branchMode === 'manual'
    ? saved.branchMode
    : saved.targetBranch
      ? 'manual'
      : 'auto',
)
const branchOptions = ref([])
const branchLoading = ref(false)
const branchError = ref('')

watch(
  () => form.cookie,
  (value) => emit('update:cookie', value),
)

watch(
  () => props.cookie,
  (value) => {
    if (value !== form.cookie) form.cookie = value
  },
)

watch(
  [form, branchMode, pasteText],
  () => {
    saveFormMemory(form, {
      branchMode: branchMode.value,
      pasteText: pasteText.value,
    })
  },
  { deep: true },
)

function validate() {
  const next = {}

  if (!form.taskName.trim() && !form.qkName.trim()) next.qkName = '请填写任务名称'
  if (form.language === '' || form.language == null) next.language = '请选择语言'
  if (!form.gitUsername.trim()) next.gitUsername = '请填写 Git 用户名'
  if (!form.gitPassword) next.gitPassword = '请填写 Git 密码'
  if (!form.projectUrl.trim()) {
    next.projectUrl = '请填写项目地址'
  } else if (!/^https?:\/\/.+|^git@.+:.+/.test(form.projectUrl.trim())) {
    next.projectUrl = '请输入有效的 Git 仓库地址'
  }
  if (!form.targetBranch.trim()) next.targetBranch = '请填写目标分支'
  if (!form.commitId.trim()) next.commitId = '请填写 Commit ID'
  if (!form.cookie.trim()) next.cookie = '请粘贴扫描平台 Cookie（含 XSRF-TOKEN 与 JSESSIONID）'

  Object.keys(errors).forEach((key) => delete errors[key])
  Object.assign(errors, next)
  return Object.keys(next).length === 0
}

async function loadLanguages() {
  languageError.value = ''
  if (!form.cookie.trim()) {
    languageError.value = '请先填写 Cookie'
    return
  }

  languageLoading.value = true
  try {
    const data = await fetchLanguageEngines(form.cookie)
    languageRaw.value = data
    const options = normalizeLanguageOptions(data)
    if (options.length) {
      languageOptions.value = options
    } else {
      languageError.value = '接口已返回，但未能解析语言字段，仍使用本地兜底列表'
      languageOptions.value = [...LANGUAGES]
    }
  } catch (err) {
    languageError.value = err?.message || '语言列表加载失败'
    languageOptions.value = [...LANGUAGES]
  } finally {
    languageLoading.value = false
  }
}

async function loadBranches() {
  branchError.value = ''
  if (!form.cookie.trim()) {
    branchError.value = '请先填写 Cookie'
    return
  }
  if (!form.projectUrl.trim()) {
    branchError.value = '请先填写项目地址'
    return
  }
  if (!form.gitUsername.trim() || !form.gitPassword) {
    branchError.value = '请先填写 Git 名称和密码'
    return
  }

  branchLoading.value = true
  try {
    const data = await fetchGitBranches(form.cookie, {
      url: form.projectUrl,
      username: form.gitUsername,
      password: form.gitPassword,
      connectTypeIndex: 0,
    })
    const options = normalizeBranchOptions(data)
    branchOptions.value = options
    if (!options.length) {
      branchError.value = '未获取到分支，可切换为手动填写'
      return
    }
    if (!options.includes(form.targetBranch)) {
      form.targetBranch = options.includes('main')
        ? 'main'
        : options.includes('master')
          ? 'master'
          : options[0]
    }
  } catch (err) {
    branchError.value = err?.message || '分支获取失败'
    branchOptions.value = []
  } finally {
    branchLoading.value = false
  }
}

function setBranchMode(mode) {
  branchMode.value = mode
  branchError.value = ''
  if (mode === 'auto' && !branchOptions.value.length) {
    loadBranches()
  }
}

async function onSubmit() {
  result.value = null
  submitError.value = ''
  if (!validate()) return

  persistMemory()
  submitting.value = true
  try {
    result.value = await submitQuickCheck(form)
  } catch (err) {
    submitError.value = err?.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function persistMemory() {
  saveFormMemory(form, {
    branchMode: branchMode.value,
    pasteText: pasteText.value,
  })
}

function applyMemory(info) {
  if (!info || typeof info !== 'object') return
  form.assignee = info.assignee ?? form.assignee ?? ''
  form.qkName = info.qkName ?? ''
  form.taskName = info.taskName ?? ''
  form.goal = info.goal ?? ''
  form.language = info.language === '' || info.language == null ? '' : info.language
  form.gitUsername = info.gitUsername ?? ''
  form.gitPassword = info.gitPassword ?? ''
  form.projectUrl = info.projectUrl ?? ''
  form.targetBranch = info.targetBranch ?? ''
  form.commitId = info.commitId ?? ''
  if (info.cookie) form.cookie = info.cookie
  if (info.isJ2ee != null && info.isJ2ee !== '') form.isJ2ee = info.isJ2ee
  if (info.jdkVersion !== '' && info.jdkVersion != null) form.jdkVersion = info.jdkVersion
  if (info.pkToolTemplate !== '' && info.pkToolTemplate != null) {
    form.pkToolTemplate = info.pkToolTemplate
  }
  if (info.pasteText != null) pasteText.value = String(info.pasteText)
  if (info.branchMode === 'auto' || info.branchMode === 'manual') {
    branchMode.value = info.branchMode
  }
}

function applyPreset(preset) {
  form.qkName = preset.qkName || ''
  form.taskName = preset.taskName || ''
  if (preset.language !== undefined && preset.language !== null) {
    form.language = preset.language
  }
  form.projectUrl = preset.projectUrl || ''
  form.targetBranch = preset.targetBranch || ''
  form.commitId = preset.commitId || ''
  // 保留已记忆的 Git 账号密码
  branchMode.value = 'manual'
  branchOptions.value = []
  branchError.value = ''
  memoryTip.value = `已填充：${preset.label}`
  persistMemory()
  Object.keys(errors).forEach((key) => delete errors[key])
}

function applyParsed(parsed) {
  if (parsed.qkName) form.qkName = parsed.qkName
  if (parsed.taskName) form.taskName = parsed.taskName
  if (parsed.projectUrl) form.projectUrl = parsed.projectUrl
  if (parsed.targetBranch) {
    form.targetBranch = parsed.targetBranch
    branchMode.value = 'manual'
  }
  if (parsed.commitId) form.commitId = parsed.commitId
  if (parsed.language != null && parsed.language !== '') form.language = parsed.language
  if (parsed.gitUsername) form.gitUsername = parsed.gitUsername
  if (parsed.gitPassword) form.gitPassword = parsed.gitPassword
  if (parsed.cookie) {
    form.cookie = parsed.cookie
    emit('update:cookie', form.cookie)
  }
}

/** 有仓库地址，或识别出 ≥2 个字段，或单字段高置信 → 自动填入 */
function shouldAutoApply(parsed) {
  if (!parsed?.matched?.length) return false
  if (parsed.projectUrl) return true
  if (parsed.matched.length >= 2) return true
  const top = parsed.hints?.[0]
  return Boolean(top && top.confidence >= 85)
}

function formatPasteHint(parsed) {
  const n = parsed.matched.length
  const inferred = (parsed.hints || []).filter((h) => h.confidence < 60).length
  let msg = `已识别 ${n} 项：${parsed.matched.join('、')}`
  if (inferred) msg += `（其中 ${inferred} 项为推断，请核对）`
  return msg
}

function onRecognizePaste() {
  pasteHint.value = ''
  pasteHints.value = []
  const parsed = recognizeFromText(pasteText.value, { force: true })
  if (!parsed.matched.length) {
    pasteHint.value =
      '未识别到有效信息。可粘贴：聊天记录、git clone、GitLab tree/commit 链接、或「名称+地址+分支+历史id」'
  }
}

function recognizeFromText(text, { force = false } = {}) {
  const parsed = parseScanPaste(text)
  pasteHints.value = parsed.hints || []
  if (!parsed.matched.length) return parsed
  if (!force && !shouldAutoApply(parsed)) {
    pasteHint.value = `检测到：${parsed.matched.join('、')}（信息偏少，点「重新识别」确认填入）`
    return parsed
  }
  applyParsed(parsed)
  branchOptions.value = []
  branchError.value = ''
  memoryTip.value = ''
  pasteHint.value = formatPasteHint(parsed)
  persistMemory()
  Object.keys(errors).forEach((key) => delete errors[key])
  if (parsed.cookie) loadLanguages()
  return parsed
}

function onPasteAreaInput() {
  if (!pasteText.value.trim()) {
    pasteHint.value = ''
    pasteHints.value = []
    return
  }
  recognizeFromText(pasteText.value)
}

function onPasteBoxPaste(event) {
  const text = event.clipboardData?.getData('text') || ''
  if (!text.trim()) return
  pasteText.value = text
  event.preventDefault()
  recognizeFromText(text)
}

function onReset() {
  const cookieKeep = form.cookie
  const remembered = loadFormMemory()
  applyMemory(remembered)
  // 清空操作仍保留当前 Cookie（会话不断），其余回填浏览器记忆
  form.cookie = cookieKeep || remembered.cookie || form.cookie
  if (remembered.branchMode !== 'auto' && remembered.branchMode !== 'manual') {
    branchMode.value = form.targetBranch ? 'manual' : 'auto'
  }
  branchOptions.value = []
  branchError.value = ''
  pasteHint.value = ''
  pasteHints.value = []
  memoryTip.value = '已从浏览器记忆回填'
  Object.keys(errors).forEach((key) => delete errors[key])
  result.value = null
  submitError.value = ''
  emit('update:cookie', form.cookie)
  persistMemory()
}

onMounted(() => {
  emit('update:cookie', form.cookie)
  if (form.cookie.trim()) loadLanguages()
})
</script>

<template>
  <form
    class="rounded-2xl border border-line bg-panel/90 p-6 shadow-[0_20px_50px_-28px_rgba(15,28,46,0.35)] backdrop-blur sm:p-8"
    @submit.prevent="onSubmit"
  >
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">填报</h2>
        <p class="mt-1 text-sm text-ink-muted">
          所有输入项自动记住（含智能识别框）；刷新后回填。
        </p>
        <p v-if="memoryTip" class="mt-1 text-sm text-accent">{{ memoryTip }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="preset in PROJECT_PRESETS"
          :key="preset.id"
          type="button"
          class="rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent hover:text-white"
          @click="applyPreset(preset)"
        >
          填充 {{ preset.label }}
        </button>
        <a
          class="text-sm text-accent underline-offset-2 hover:underline"
          :href="SCAN_LIST_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开扫描任务列表
        </a>
      </div>
    </div>

    <div class="grid gap-5">
      <div class="rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 p-4">
        <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label for="pasteBox" class="block text-sm font-medium text-ink">
            智能识别（粘贴整段信息）
          </label>
          <button
            type="button"
            class="text-xs font-medium text-accent hover:underline"
            @click="onRecognizePaste"
          >
            重新识别
          </button>
        </div>
        <textarea
          id="pasteBox"
          v-model="pasteText"
          rows="4"
          class="field min-h-[6rem] resize-y font-mono text-[0.85rem] leading-relaxed"
          placeholder="像填快递单一样，整段粘贴即可。支持：&#10;· 名称 + 仓库地址 + 分支 + 历史id&#10;· git clone -b 分支 https://...&#10;· GitLab/GitHub 的 /tree/分支、/commit/哈希 链接&#10;· 混有 Cookie / 语言 / Git 账号的聊天记录"
          @paste="onPasteBoxPaste"
          @blur="onPasteAreaInput"
        />
        <p class="mt-1.5 text-xs text-ink-muted">
          分层识别：链接结构 → 标签键值 → 裸字段 → 仓库名/路径推断语言与名称。
        </p>
        <p v-if="pasteHint" class="mt-1 text-sm text-accent">{{ pasteHint }}</p>
        <ul v-if="pasteHints.length" class="mt-2 flex flex-wrap gap-1.5">
          <li
            v-for="hint in pasteHints"
            :key="hint.field"
            class="max-w-full rounded-md border border-line bg-panel px-2 py-1 text-[0.7rem] leading-snug text-ink-muted"
            :title="`${hint.source}（置信 ${hint.confidence}）`"
          >
            <span class="font-medium text-ink">{{ hint.label }}</span>
            <span class="mx-1 text-line">·</span>
            <span class="break-all">{{ hint.value }}</span>
            <span class="ml-1 opacity-70">{{ hint.source }}</span>
          </li>
        </ul>
      </div>

      <div>
        <label for="cookie" class="mb-1.5 block text-sm font-medium text-ink">
          扫描平台 Cookie
        </label>
        <div class="relative">
          <textarea
            id="cookie"
            v-model="form.cookie"
            :rows="showCookie ? 3 : 2"
            class="field font-mono text-[0.8rem] leading-relaxed"
            :class="{ 'field-error': errors.cookie }"
            :placeholder="'XSRF-TOKEN=...; JSESSIONID=...'"
          />
          <button
            type="button"
            class="absolute right-2 top-2 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
            @click="showCookie = !showCookie"
          >
            {{ showCookie ? '收起' : '展开' }}
          </button>
        </div>
        <p class="mt-1.5 text-xs text-ink-muted">
          用于 list / engine / check；经本地代理转发。
        </p>
        <p v-if="errors.cookie" class="mt-1.5 text-sm text-danger">{{ errors.cookie }}</p>
      </div>
<!-- 
      <div>
        <label for="goal" class="mb-1.5 block text-sm font-medium text-ink">目标说明</label>
        <textarea
          id="goal"
          v-model="form.goal"
          rows="4"
          class="field min-h-[6rem] resize-y leading-relaxed"
          placeholder="复扫与修复目标…"
        />
      </div> -->

      <div class="grid gap-5 sm:grid-cols-2">
        <div>
          <label for="qkName" class="mb-1.5 block text-sm font-medium text-ink">名称（qkName）</label>
          <input
            id="qkName"
            v-model="form.qkName"
            type="text"
            autocomplete="off"
            placeholder="例如：会议助手"
            class="field"
            :class="{ 'field-error': errors.qkName }"
          />
          <p v-if="errors.qkName" class="mt-1.5 text-sm text-danger">{{ errors.qkName }}</p>
        </div>
        <div>
          <label for="taskName" class="mb-1.5 block text-sm font-medium text-ink">固定任务名</label>
          <input
            id="taskName"
            v-model="form.taskName"
            type="text"
            autocomplete="off"
            placeholder="例如：会议助手-gp"
            class="field"
          />
        </div>
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between gap-3">
          <label for="language" class="block text-sm font-medium text-ink">语言</label>
          <button
            type="button"
            class="text-xs font-medium text-accent hover:underline"
            :disabled="languageLoading"
            @click="loadLanguages"
          >
            {{ languageLoading ? '加载中…' : '从引擎接口刷新' }}
          </button>
        </div>
        <select
          id="language"
          v-model="form.language"
          class="field"
          :class="{ 'field-error': errors.language }"
        >
          <option disabled value="">请选择项目主要语言</option>
          <option
            v-for="item in languageOptions"
            :key="`${item.value}-${item.label}`"
            :value="item.value"
          >
            {{ item.label }}（{{ item.value }}）
          </option>
        </select>
        <p v-if="languageError" class="mt-1.5 text-sm text-warn">{{ languageError }}</p>
        <p v-if="errors.language" class="mt-1.5 text-sm text-danger">{{ errors.language }}</p>
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
        <div>
          <label for="gitUsername" class="mb-1.5 block text-sm font-medium text-ink">
            Git 名称
          </label>
          <input
            id="gitUsername"
            v-model="form.gitUsername"
            type="text"
            autocomplete="username"
            placeholder="仓库访问账号"
            class="field"
            :class="{ 'field-error': errors.gitUsername }"
          />
          <p v-if="errors.gitUsername" class="mt-1.5 text-sm text-danger">
            {{ errors.gitUsername }}
          </p>
        </div>

        <div>
          <label for="gitPassword" class="mb-1.5 block text-sm font-medium text-ink">
            Git 密码
          </label>
          <div class="relative">
            <input
              id="gitPassword"
              v-model="form.gitPassword"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="密码或访问令牌"
              class="field pr-16"
              :class="{ 'field-error': errors.gitPassword }"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-xs font-medium text-ink-muted hover:text-ink"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
          <p v-if="errors.gitPassword" class="mt-1.5 text-sm text-danger">
            {{ errors.gitPassword }}
          </p>
        </div>
      </div>

      <div>
        <label for="projectUrl" class="mb-1.5 block text-sm font-medium text-ink">
          项目地址
        </label>
        <input
          id="projectUrl"
          v-model="form.projectUrl"
          type="text"
          autocomplete="off"
          placeholder="http://git.example.com/group/repo.git"
          class="field font-mono text-[0.925rem]"
          :class="{ 'field-error': errors.projectUrl }"
        />
        <p v-if="errors.projectUrl" class="mt-1.5 text-sm text-danger">
          {{ errors.projectUrl }}
        </p>
      </div>

      <div>
        <div class="mb-1.5 flex flex-wrap items-center justify-between gap-3">
          <label for="targetBranch" class="block text-sm font-medium text-ink">目标分支</label>
          <div class="flex items-center gap-3 text-xs">
            <div class="inline-flex overflow-hidden rounded-lg border border-line">
              <button
                type="button"
                class="px-2.5 py-1 transition"
                :class="branchMode === 'auto' ? 'bg-accent text-white' : 'bg-white text-ink-muted hover:text-ink'"
                @click="setBranchMode('auto')"
              >
                自动获取
              </button>
              <button
                type="button"
                class="px-2.5 py-1 transition"
                :class="branchMode === 'manual' ? 'bg-accent text-white' : 'bg-white text-ink-muted hover:text-ink'"
                @click="setBranchMode('manual')"
              >
                手动填写
              </button>
            </div>
            <button
              v-if="branchMode === 'auto'"
              type="button"
              class="font-medium text-accent hover:underline disabled:opacity-60"
              :disabled="branchLoading"
              @click="loadBranches"
            >
              {{ branchLoading ? '获取中…' : '刷新分支' }}
            </button>
          </div>
        </div>

        <select
          v-if="branchMode === 'auto'"
          id="targetBranch"
          v-model="form.targetBranch"
          class="field font-mono text-[0.925rem]"
          :class="{ 'field-error': errors.targetBranch }"
        >
          <option disabled value="">请选择分支</option>
          <option v-for="item in branchOptions" :key="item" :value="item">
            {{ item }}
          </option>
        </select>

        <input
          v-else
          id="targetBranch"
          v-model="form.targetBranch"
          type="text"
          autocomplete="off"
          placeholder="main / release / feature-xxx"
          class="field font-mono text-[0.925rem]"
          :class="{ 'field-error': errors.targetBranch }"
        />

        <p class="mt-1.5 text-xs text-ink-muted">
          自动获取调用 POST /api/v1/rest/getAllBranch
        </p>
        <p v-if="branchError" class="mt-1.5 text-sm text-warn">{{ branchError }}</p>
        <p v-if="errors.targetBranch" class="mt-1.5 text-sm text-danger">
          {{ errors.targetBranch }}
        </p>
      </div>

      <div>
        <label for="commitId" class="mb-1.5 block text-sm font-medium text-ink">
          Commit ID
        </label>
        <input
          id="commitId"
          v-model="form.commitId"
          type="text"
          autocomplete="off"
          placeholder="完整或短 hash"
          class="field font-mono text-[0.925rem]"
          :class="{ 'field-error': errors.commitId }"
        />
        <p v-if="errors.commitId" class="mt-1.5 text-sm text-danger">
          {{ errors.commitId }}
        </p>
      </div>
    </div>

    <div
      v-if="result"
      class="mt-6 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3 text-sm text-accent"
      role="status"
    >
      <p class="font-medium">扫描任务已提交</p>
      <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-ink">{{
        JSON.stringify(result, null, 2)
      }}</pre>
    </div>

    <div
      v-if="submitError"
      class="mt-6 rounded-xl border border-danger/20 bg-red-50 px-4 py-3 text-sm text-danger"
      role="alert"
    >
      {{ submitError }}
    </div>

    <div class="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button type="button" class="btn-secondary" :disabled="submitting" @click="onReset">
        清空填报
      </button>
      <button type="submit" class="btn-primary" :disabled="submitting">
        {{ submitting ? '提交中…' : '发起复扫' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
@reference "../style.css";

.field {
  @apply w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition;
  @apply placeholder:text-ink-muted/60;
  @apply focus:border-accent focus:ring-2 focus:ring-accent/20;
}

.field-error {
  @apply border-danger focus:border-danger focus:ring-danger/15;
}

.btn-primary {
  @apply inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition;
  @apply hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60;
}

.btn-secondary {
  @apply inline-flex items-center justify-center rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink transition;
  @apply hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60;
}
</style>

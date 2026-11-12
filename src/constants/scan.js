/**
 * 扫描平台语言枚举（与代码卫士前端一致）
 * 0=Java, 9=JS/TS …
 */
export const LANGUAGES = [
  { value: 0, label: 'Java' },
  { value: 1, label: 'C/C++' },
  { value: 2, label: 'C#' },
  { value: 3, label: 'Python' },
  { value: 4, label: 'PHP' },
  { value: 5, label: 'Objective-C' },
  { value: 6, label: 'Cobol' },
  { value: 7, label: 'Java(Android)' },
  { value: 8, label: 'ActionScript' },
  { value: 9, label: 'JS/TS' },
  { value: 10, label: 'Java(APK)' },
  { value: 11, label: 'SQL' },
  { value: 12, label: 'Go' },
  { value: 13, label: 'Ruby' },
  { value: 14, label: 'VB.NET' },
  { value: 15, label: 'Swift' },
  { value: 16, label: 'Kotlin' },
  { value: 17, label: 'Scala' },
  { value: 18, label: 'Lua' },
  { value: 19, label: 'Shell' },
  { value: 20, label: 'Fortran' },
]

/** 缺陷等级：1低 / 3中 / 5高 / 6不是问题 / 9遗留（平台 E()） */
export const AUDIT_LEVEL = {
  LOW: 1,
  MID: 3,
  HIGH: 5,
  NOT_ISSUE: 6,
  LEGACY: 9,
}

export const SCAN_LIST_URL = 'https://10.10.107.153/#/codeCheck/code-check-list'
export const SCAN_API_PATH = '/api/v1/quickcheck/check'
export const SCAN_LIST_API_PATH = '/api/v1/quickcheck/list'
export const LANGUAGE_API_PATH = '/api/v1/rest/schedule/engine'
export const REPORT_EXPORT_API_PATH = '/api/v1/rest/report/newExport/task'
export const REPORT_LIST_API_PATH = '/api/v1/rest/report'
export const BRANCH_API_PATH = '/api/v1/rest/getAllBranch'
export const RULE_CODE_API_PATH = '/api/v1/rule/queryRuleCodeByRefNames'
/** 任务命中缺陷类型/规则：/api/v1/rest/result/{pkTask}/types */
export const RESULT_TYPES_API_PREFIX = '/api/v1/rest/result'
export const BUG_TYPES_API_PREFIX = '/api/v1/result/bugTypes'
export const COOKIE_SESSION_KEY = 'ldsm.scan.cookie'

/**
 * 生成报告 body
 * - ruleCodeList：优先任务命中规则，与列表问题数对齐
 * - auditLevels：只用 低/中/高，对应列表 problemNum1/3/5
 */
export function buildReportExportPayload({ reportName, pkTask, ruleCodeList } = {}) {
  const name = String(reportName || '扫描报告').trim()
  const codes = Array.isArray(ruleCodeList) ? ruleCodeList.map(String).filter(Boolean) : []
  if (!codes.length) {
    throw new Error('缺少 ruleCodeList：请先查询任务命中规则')
  }

  return {
    reportName: name,
    extension: 0,
    checkType: 0,
    checkCondition: {
      reportName: name,
      extension: 0,
      checkType: 0,
      reportLevel: 0,
      pkTask: Number(pkTask),
      pHighShow: 'Y',
      pMidShow: 'Y',
      pLowShow: 'Y',
      // 1=是问题，3=常见「未审计/待处理」状态码（平台导出默认）
      newAuditStatus: [1, 3],
      // 与列表高/中/低一致：5高 3中 1低（不含 6不是问题、9遗留）
      auditLevels: [AUDIT_LEVEL.LOW, AUDIT_LEVEL.MID, AUDIT_LEVEL.HIGH],
      ifOnlySum: 'N',
      bugDetailMerger: false,
      ifAdv: 'Y',
      ifCommitter: 'N',
      auditLog: '0',
      exportCyclomaticComplexity: false,
      exportBugBurstLines: false,
      ifTrace: 'Y',
      ruleCollection: null,
      ruleCodeList: codes,
    },
  }
}

/**
 * 默认任务：仅保留扫描平台 Cookie；其余填报字段留空。
 * 填报内容由浏览器 localStorage 记忆（见 formStorage）。
 */
export const DEFAULT_TASK = {
  assignee: '',
  taskName: '',
  qkName: '',
  goal: '',
  language: '',
  gitUsername: '',
  gitPassword: '',
  projectUrl: '',
  targetBranch: '',
  commitId: '',
  cookie:
    'XSRF-TOKEN=905587d7-9672-4d13-aba9-4a9619319a3c; JSESSIONID=2EC5AA51841BA614DCEF38E7A44885D6',
  isJ2ee: 'Y',
  jdkVersion: 4,
  pkToolTemplate: 135,
}

/** 常用项目一键填充 */
export const PROJECT_PRESETS = [
  {
    id: 'training-monitor',
    label: '训练计划监控',
    qkName: '训练计划监控',
    taskName: '训练计划监控-gp',
    language: 9,
    projectUrl: 'http://10.155.79.10:9999/meap-airchina/x5-training_monitor.git',
    targetBranch: 'feature-feature-vue3-20260731-fs-lousao',
    commitId: '16d7aa93f166d50c5c8e6c0222f7ce22129c0f03',
  },
]

export function buildCheckPayload(form) {
  return {
    taskDesc: form.goal?.trim() || '',
    qkName: form.qkName.trim() || form.taskName.trim(),
    codeVO: {
      codeProjectType: 0,
      packageType: 0,
      getCodeType: 2,
      codeName: '',
      savePath: '',
      compilerOs: 0,
      language: Number(form.language),
      isJ2ee: form.isJ2ee || 'Y',
      jdkVersion: Number(form.jdkVersion) || 4,
      csharpCompiler: 0,
      csharpFilePath: '',
      cCompilerCmd: '',
      agentTag: '',
      gitToken: '',
      gitBranchName: form.targetBranch.trim(),
      commitId: form.commitId.trim(),
      svnGitUri: form.projectUrl.trim(),
      svnGitUserName: form.gitUsername.trim(),
      svnGitPwd: form.gitPassword,
      folder: '',
      useSSL: 0,
      markName: '',
      appShortName: '',
      measures: false,
      llmsJudgementBit: 0,
      agentLabel: '',
      catalogType: 0,
    },
    quickVOs: [
      {
        checkType: 0,
        taskToolVOs: [
          {
            tool: 0,
            pkToolTemplate: Number(form.pkToolTemplate) || 135,
            os: 1,
          },
        ],
        quickPerm: 0,
        userPks: [],
        orgPks: [],
        safeFunctionVOs: [],
      },
    ],
  }
}

export function extractXsrfToken(cookie) {
  const match = String(cookie || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i)
  return match ? decodeURIComponent(match[1]) : ''
}

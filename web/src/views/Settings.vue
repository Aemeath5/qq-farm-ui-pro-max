/* eslint-disable no-alert, unused-imports/no-unused-vars */

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import api from '@/api' // Apply config from server if possible
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import { getThemeBackgroundPreset, getThemeOption, LOGIN_BACKGROUND_PRESETS, type LoginBackgroundPreset, UI_BACKGROUND_SCOPE_OPTIONS } from '@/constants/ui-appearance'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useFarmStore } from '@/stores/farm'
import { useFriendStore } from '@/stores/friend'
import { type ReportLogEntry, useSettingStore } from '@/stores/setting'

const REPORT_HISTORY_VIEW_STORAGE_KEY = 'qq-farm-bot:report-history-view:v1'

function loadReportHistoryViewPreferences() {
  try {
    const raw = localStorage.getItem(REPORT_HISTORY_VIEW_STORAGE_KEY)
    if (!raw)
      return { mode: 'all', status: 'all', keyword: '', sortOrder: 'desc' as 'desc' | 'asc', pageSize: 10 }
    const parsed = JSON.parse(raw)
    const mode = ['all', 'test', 'hourly', 'daily'].includes(parsed?.mode) ? parsed.mode : 'all'
    const status = ['all', 'success', 'failed'].includes(parsed?.status) ? parsed.status : 'all'
    const sortOrder = ['asc', 'desc'].includes(parsed?.sortOrder) ? parsed.sortOrder : 'desc'
    const pageSize = [10, 20, 50, 100].includes(Number(parsed?.pageSize)) ? Number(parsed.pageSize) : 10
    const keyword = String(parsed?.keyword || '').slice(0, 100)
    return { mode, status, keyword, sortOrder, pageSize }
  }
  catch {
    return { mode: 'all', status: 'all', keyword: '', sortOrder: 'desc' as 'desc' | 'asc', pageSize: 10 }
  }
}

const settingStore = useSettingStore()
const appStore = useAppStore()
appStore.fetchUIConfig()
const accountStore = useAccountStore()
const farmStore = useFarmStore()
const friendStore = useFriendStore()
const reportHistoryViewPrefs = loadReportHistoryViewPreferences()

const { settings, loading, reportLogs, reportLogPagination, reportLogStats } = storeToRefs(settingStore)
const { currentAccountId, accounts } = storeToRefs(accountStore)
const { seeds } = storeToRefs(farmStore)
const { friends } = storeToRefs(friendStore)

const saving = ref(false)
const passwordSaving = ref(false)
const offlineSaving = ref(false)
const trialSaving = ref(false)
const timingSaving = ref(false)
const reportTesting = ref(false)
const reportSendingMode = ref<'hourly' | 'daily' | ''>('')
const reportHistoryLoading = ref(false)
const reportHistoryClearing = ref(false)
const reportHistoryExporting = ref(false)
const reportHistoryBatchDeleting = ref(false)
const reportHistoryDeletingIds = ref<number[]>([])
const expandedReportLogIds = ref<number[]>([])
const selectedReportLogIds = ref<number[]>([])
const reportDetailVisible = ref(false)
const reportDetailItem = ref<ReportLogEntry | null>(null)
const reportFilters = ref({
  mode: reportHistoryViewPrefs.mode,
  status: reportHistoryViewPrefs.status,
})
const reportKeyword = ref(reportHistoryViewPrefs.keyword)
const reportSortOrder = ref<'desc' | 'asc'>(reportHistoryViewPrefs.sortOrder)
const reportPageSize = ref(reportHistoryViewPrefs.pageSize)
const reportHistoryStatsCards = computed(() => [
  {
    key: 'total',
    label: '当前结果总数',
    value: reportLogStats.value.total,
    tone: 'text-gray-900 dark:text-gray-100',
    bg: 'bg-slate-100/80 dark:bg-slate-800/40',
    active: reportFilters.value.mode === 'all' && reportFilters.value.status === 'all',
  },
  {
    key: 'success',
    label: '成功',
    value: reportLogStats.value.successCount,
    tone: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-100/80 dark:bg-emerald-900/30',
    active: reportFilters.value.status === 'success',
  },
  {
    key: 'failed',
    label: '失败',
    value: reportLogStats.value.failedCount,
    tone: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-100/80 dark:bg-red-900/30',
    active: reportFilters.value.status === 'failed',
  },
  {
    key: 'test',
    label: '测试汇报',
    value: reportLogStats.value.testCount,
    tone: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-100/80 dark:bg-sky-900/30',
    active: reportFilters.value.mode === 'test',
  },
  {
    key: 'hourly',
    label: '小时汇报',
    value: reportLogStats.value.hourlyCount,
    tone: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-100/80 dark:bg-amber-900/30',
    active: reportFilters.value.mode === 'hourly',
  },
  {
    key: 'daily',
    label: '日报',
    value: reportLogStats.value.dailyCount,
    tone: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-100/80 dark:bg-violet-900/30',
    active: reportFilters.value.mode === 'daily',
  },
])

// === 危险频率拦截警告 ===
const timeWarningVisible = computed(() => {
  // eslint-disable-next-line ts/no-use-before-define
  if (!localSettings.value.intervals)
    return false
  // eslint-disable-next-line ts/no-use-before-define
  const { farmMin, farmMax, friendMin, friendMax, helpMin, helpMax, stealMin, stealMax } = localSettings.value.intervals
  return (
    (typeof farmMin === 'number' && farmMin < 15)
    || (typeof farmMax === 'number' && farmMax < 15)
    || (typeof friendMin === 'number' && friendMin < 60)
    || (typeof friendMax === 'number' && friendMax < 60)
    || (typeof helpMin === 'number' && helpMin < 60)
    || (typeof helpMax === 'number' && helpMax < 60)
    || (typeof stealMin === 'number' && stealMin < 60)
    || (typeof stealMax === 'number' && stealMax < 60)
  )
})

// ============ 用户身份识别 ============
const isAdmin = computed(() => {
  try {
    const u = JSON.parse(localStorage.getItem('current_user') || 'null')
    return u?.role === 'admin'
  }
  catch { return false }
})

// 当前登录用户名（用于密码修改等用户隔离场景）
const currentUsername = computed(() => {
  try {
    const u = JSON.parse(localStorage.getItem('current_user') || 'null')
    return u?.username || ''
  }
  catch { return '' }
})

const trialConfig = ref({
  enabled: true,
  days: 1,
  dailyLimit: 50,
  cooldownMs: 14400000,
  adminRenewEnabled: true,
  userRenewEnabled: false,
  maxAccounts: 1,
})

const clusterConfig = ref({
  dispatcherStrategy: 'round_robin',
})
const clusterSaving = ref(false)

const clusterStrategyOptions = [
  { label: '轮询洗牌 (Round Robin)', value: 'round_robin' },
  { label: '最小负荷与粘性推流 (Least Load)', value: 'least_load' },
]

const trialDaysOptions = [
  { label: '1 天', value: 1 },
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '永久', value: 0 },
]

const thirdPartyApiConfig = ref({
  wxApiKey: '',
  wxApiUrl: '',
  wxAppId: '',
  ipad860Url: '',
  aineisheKey: '',
})
const thirdPartyApiSaving = ref(false)

const trialCooldownOptions = [
  { label: '1 小时', value: 3600000 },
  { label: '2 小时', value: 7200000 },
  { label: '4 小时', value: 14400000 },
  { label: '8 小时', value: 28800000 },
]

async function loadTrialConfig() {
  if (!isAdmin.value)
    return
  try {
    const res = await api.get('/api/trial-card-config')
    if (res.data.ok && res.data.data) {
      trialConfig.value = { ...trialConfig.value, ...res.data.data }
    }
  }
  catch { /* 静默 */ }
}

async function saveTrialConfig() {
  trialSaving.value = true
  try {
    const res = await api.post('/api/trial-card-config', trialConfig.value)
    if (res.data.ok) {
      showAlert('体验卡配置已保存')
    }
    else {
      showAlert(`保存失败: ${res.data.error}`, 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message}`, 'danger')
  }
  finally {
    trialSaving.value = false
  }
}

async function loadClusterConfig() {
  if (!isAdmin.value)
    return
  const data = await settingStore.fetchClusterConfig()
  if (data) {
    clusterConfig.value = { ...clusterConfig.value, ...data }
  }
}

async function saveClusterConfig() {
  clusterSaving.value = true
  try {
    const res = await settingStore.saveClusterConfig(clusterConfig.value)
    if (res.ok) {
      showAlert('分布式与集群策略已保存并即时生效')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message}`, 'danger')
  }
  finally {
    clusterSaving.value = false
  }
}

async function loadThirdPartyApiConfig() {
  if (!isAdmin.value)
    return
  try {
    const res = await api.get('/api/admin/third-party-api')
    if (res.data.ok && res.data.data) {
      thirdPartyApiConfig.value = { ...thirdPartyApiConfig.value, ...res.data.data }
    }
  }
  catch { /* 静默 */ }
}

async function saveThirdPartyApiConfig() {
  thirdPartyApiSaving.value = true
  try {
    const res = await api.post('/api/admin/third-party-api', thirdPartyApiConfig.value)
    if (res.data.ok) {
      showAlert('第三方 API 配置已保存')
    }
    else {
      showAlert(`保存失败: ${res.data.error}`, 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message}`, 'danger')
  }
  finally {
    thirdPartyApiSaving.value = false
  }
}

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})
const DEFAULT_LOGIN_BACKGROUND_OVERLAY_OPACITY = 30
const DEFAULT_LOGIN_BACKGROUND_BLUR = 2
const DEFAULT_APP_BACKGROUND_OVERLAY_OPACITY = 60
const DEFAULT_APP_BACKGROUND_BLUR = 8
const loginBackgroundPresets = LOGIN_BACKGROUND_PRESETS

const loginPreviewVisible = ref(false)
const loginPreviewLoading = ref(false)
const loginPreviewLoadFailed = ref(false)
const backgroundSaving = ref(false)
const backgroundUploading = ref(false)
const backgroundFileInput = ref<HTMLInputElement | null>(null)
let loginPreviewRequestId = 0

const loginPreviewUsesCustomBackground = computed(() => {
  return !!appStore.loginBackground.trim() && !loginPreviewLoadFailed.value
})

const loginPreviewBackgroundStyle = computed(() => {
  if (loginPreviewUsesCustomBackground.value) {
    return {
      backgroundImage: `url(${appStore.loginBackground.trim()})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }

  return {
    background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)',
  }
})

const loginPreviewMaskStyle = computed(() => ({
  backgroundColor: `rgba(0, 0, 0, ${appStore.loginBackgroundOverlayOpacity / 100})`,
  backdropFilter: `blur(${appStore.loginBackgroundBlur}px)`,
  WebkitBackdropFilter: `blur(${appStore.loginBackgroundBlur}px)`,
}))
const appScenePreviewMaskStyle = computed(() => ({
  backgroundColor: `rgba(8, 12, 24, ${appStore.appBackgroundOverlayOpacity / 100})`,
  backdropFilter: `blur(${appStore.appBackgroundBlur}px)`,
  WebkitBackdropFilter: `blur(${appStore.appBackgroundBlur}px)`,
}))
const currentThemeOption = computed(() => getThemeOption(appStore.colorTheme))
const currentThemeBackgroundPreset = computed(() => getThemeBackgroundPreset(appStore.colorTheme))
const orderedLoginBackgroundPresets = computed(() => {
  const currentThemeKey = appStore.colorTheme
  return [...loginBackgroundPresets].sort((a, b) => {
    const aRank = a.themeKey === currentThemeKey ? 0 : (a.builtIn ? 1 : 2)
    const bRank = b.themeKey === currentThemeKey ? 0 : (b.builtIn ? 1 : 2)
    return aRank - bRank
  })
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

function openLoginPreview() {
  loginPreviewVisible.value = true
}

function isSelectedLoginBackgroundPreset(preset: LoginBackgroundPreset) {
  return preset.url.trim() === appStore.loginBackground.trim()
}

function applyBackgroundPreset(preset: LoginBackgroundPreset) {
  appStore.loginBackground = preset.url
  if (preset.themeKey) {
    appStore.colorTheme = preset.themeKey
  }
  appStore.loginBackgroundOverlayOpacity = preset.overlayOpacity
  appStore.loginBackgroundBlur = preset.blur
  appStore.appBackgroundOverlayOpacity = preset.appOverlayOpacity
  appStore.appBackgroundBlur = preset.appBlur
  if (!preset.url) {
    loginPreviewLoadFailed.value = false
  }
}

function applyCurrentThemeBackgroundPreset() {
  applyBackgroundPreset(currentThemeBackgroundPreset.value)
}

async function saveLoginAppearance() {
  backgroundSaving.value = true
  try {
    await appStore.setUIConfig({
      colorTheme: appStore.colorTheme,
      loginBackground: appStore.loginBackground.trim(),
      backgroundScope: appStore.backgroundScope,
      loginBackgroundOverlayOpacity: appStore.loginBackgroundOverlayOpacity,
      loginBackgroundBlur: appStore.loginBackgroundBlur,
      appBackgroundOverlayOpacity: appStore.appBackgroundOverlayOpacity,
      appBackgroundBlur: appStore.appBackgroundBlur,
    })
    showAlert('登录页背景设置已保存')
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    backgroundSaving.value = false
  }
}

async function restoreDefaultLoginAppearance() {
  appStore.loginBackground = ''
  appStore.backgroundScope = 'login_only'
  appStore.loginBackgroundOverlayOpacity = DEFAULT_LOGIN_BACKGROUND_OVERLAY_OPACITY
  appStore.loginBackgroundBlur = DEFAULT_LOGIN_BACKGROUND_BLUR
  appStore.appBackgroundOverlayOpacity = DEFAULT_APP_BACKGROUND_OVERLAY_OPACITY
  appStore.appBackgroundBlur = DEFAULT_APP_BACKGROUND_BLUR
  loginPreviewLoadFailed.value = false
  await saveLoginAppearance()
}

function triggerBackgroundUpload() {
  backgroundFileInput.value?.click()
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      }
      else {
        reject(new Error('图片读取失败'))
      }
    }
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

async function compressLoginBackgroundImage(file: File) {
  const source = await readFileAsDataUrl(file)
  const img = await loadImageElement(source)
  const naturalWidth = img.naturalWidth || img.width
  const naturalHeight = img.naturalHeight || img.height
  const maxEdge = 2200
  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('当前浏览器不支持图片压缩')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)

  const candidates: Array<{ mime: string, quality?: number }> = [
    { mime: 'image/webp', quality: 0.88 },
    { mime: 'image/webp', quality: 0.76 },
    { mime: 'image/jpeg', quality: 0.82 },
    { mime: 'image/jpeg', quality: 0.7 },
  ]

  let fallbackDataUrl = ''
  for (const candidate of candidates) {
    try {
      const dataUrl = canvas.toDataURL(candidate.mime, candidate.quality)
      if (!fallbackDataUrl) {
        fallbackDataUrl = dataUrl
      }
      if (dataUrl.length <= 7_000_000) {
        return {
          dataUrl,
          mimeType: dataUrl.match(/^data:([^;]+);/i)?.[1] || candidate.mime,
        }
      }
    }
    catch {
      // ignore unsupported mime types and try the next candidate
    }
  }

  if (!fallbackDataUrl) {
    fallbackDataUrl = canvas.toDataURL('image/png')
  }

  return {
    dataUrl: fallbackDataUrl,
    mimeType: fallbackDataUrl.match(/^data:([^;]+);/i)?.[1] || 'image/png',
  }
}

async function handleBackgroundFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (input) {
    input.value = ''
  }
  if (!file)
    return

  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    showAlert('仅支持上传 JPG / PNG / WebP 图片', 'danger')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    showAlert('原图超过 8MB，请先压缩后再上传', 'danger')
    return
  }

  backgroundUploading.value = true
  try {
    const payload = await compressLoginBackgroundImage(file)
    const res = await api.post('/api/settings/ui-background/upload', {
      filename: file.name,
      mimeType: payload.mimeType,
      dataUrl: payload.dataUrl,
    })

    if (res.data?.ok && res.data?.data?.url) {
      appStore.loginBackground = res.data.data.url
      loginPreviewLoadFailed.value = false
      showAlert('图片已上传并填充到背景地址，点击“应用背景设置”后全局生效')
    }
    else {
      showAlert(`上传失败: ${res.data?.error || '未知错误'}`, 'danger')
    }
  }
  catch (e: any) {
    showAlert(`上传失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    backgroundUploading.value = false
  }
}

const loginAppearanceEditorBindings = [
  loginBackgroundPresets,
  loginPreviewMaskStyle,
  isSelectedLoginBackgroundPreset,
  applyBackgroundPreset,
  restoreDefaultLoginAppearance,
  triggerBackgroundUpload,
  handleBackgroundFileChange,
] as const
void loginAppearanceEditorBindings

watch(() => appStore.loginBackground, (value) => {
  const nextUrl = value.trim()
  const requestId = ++loginPreviewRequestId

  loginPreviewLoading.value = false
  loginPreviewLoadFailed.value = false

  if (!nextUrl)
    return

  loginPreviewLoading.value = true

  const img = new Image()

  img.onload = () => {
    if (requestId !== loginPreviewRequestId)
      return
    loginPreviewLoading.value = false
    loginPreviewLoadFailed.value = false
  }

  img.onerror = () => {
    if (requestId !== loginPreviewRequestId)
      return
    loginPreviewLoading.value = false
    loginPreviewLoadFailed.value = true
  }

  img.src = nextUrl
}, { immediate: true })

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

const defaultReportConfig = {
  enabled: false,
  channel: 'webhook',
  endpoint: '',
  token: '',
  title: '经营汇报',
  hourlyEnabled: false,
  hourlyMinute: 5,
  dailyEnabled: true,
  dailyHour: 21,
  dailyMinute: 0,
  retentionDays: 30,
}

const reportModeOptions = [
  { label: '全部类型', value: 'all' },
  { label: '测试汇报', value: 'test' },
  { label: '小时汇报', value: 'hourly' },
  { label: '日报', value: 'daily' },
]

const reportStatusOptions = [
  { label: '全部结果', value: 'all' },
  { label: '仅成功', value: 'success' },
  { label: '仅失败', value: 'failed' },
]

const reportSortOrderOptions = [
  { label: '最新优先', value: 'desc' },
  { label: '最早优先', value: 'asc' },
]

const reportPageSizeOptions = [
  { label: '10 条/页', value: 10 },
  { label: '20 条/页', value: 20 },
  { label: '50 条/页', value: 50 },
  { label: '100 条/页', value: 100 },
]

const defaultIntervals = {
  farmMin: 30,
  farmMax: 200,
  friendMin: 100,
  friendMax: 600,
  helpMin: 100,
  helpMax: 600,
  stealMin: 100,
  stealMax: 600,
}

const defaultTradeConfig = {
  sell: {
    scope: 'fruit_only' as const,
    keepMinEachFruit: 0,
    keepFruitIds: [] as number[],
    rareKeep: {
      enabled: false,
      judgeBy: 'either' as 'plant_level' | 'unit_price' | 'either',
      minPlantLevel: 40,
      minUnitPrice: 2000,
    },
    batchSize: 15,
    previewBeforeManualSell: false,
  },
}

const selectedReportLogCount = computed(() => selectedReportLogIds.value.length)
const allVisibleReportLogsSelected = computed(() => (
  reportLogs.value.length > 0
  && reportLogs.value.every(item => selectedReportLogIds.value.includes(item.id))
))

const localSettings = ref({
  accountMode: 'main' as 'main' | 'alt' | 'safe',
  harvestDelay: { min: 180, max: 300 },
  plantingStrategy: 'preferred',
  preferredSeedId: 0,
  intervals: { ...defaultIntervals },
  friendQuietHours: { enabled: true, start: '23:00', end: '07:00' },
  stakeoutSteal: { enabled: false, delaySec: 3 },
  tradeConfig: {
    sell: {
      ...defaultTradeConfig.sell,
      keepFruitIds: [...defaultTradeConfig.sell.keepFruitIds],
      rareKeep: { ...defaultTradeConfig.sell.rareKeep },
    },
  },
  reportConfig: { ...defaultReportConfig },
  automation: {
    farm: false,
    task: false,
    sell: false,
    friend: false,
    farm_push: false,
    land_upgrade: false,
    landUpgradeTarget: 6,
    friend_steal: false,
    friend_help: false,
    friend_bad: false,
    friend_help_exp_limit: false,
    email: false,
    fertilizer_gift: false,
    fertilizer_buy: false,
    fertilizer_buy_limit: 100,
    free_gifts: false,
    share_reward: false,
    vip_gift: false,
    month_card: false,
    open_server_gift: false,
    fertilizer: 'none',
    // 偷菜过滤
    stealFilterEnabled: false,
    stealFilterMode: 'blacklist',
    stealFilterPlantIds: [] as number[],
    // 偷好友过滤
    stealFriendFilterEnabled: false,
    stealFriendFilterMode: 'blacklist',
    stealFriendFilterIds: [] as number[],
    friend_auto_accept: false,
    fertilizer_60s_anti_steal: false,
    fertilizer_smart_phase: false,
    fastHarvest: false,
    forceGetAllEnabled: false,
  },
})
const tradeKeepFruitIdsText = ref('')

const localOffline = ref({
  channel: 'webhook',
  reloginUrlMode: 'none',
  endpoint: '',
  token: '',
  title: '',
  msg: '',
  offlineDeleteSec: 0,
})

const localTiming = ref({
  heartbeatIntervalMs: 25000,
  rateLimitIntervalMs: 334,
  ghostingProbability: 0.02,
  ghostingCooldownMin: 240,
  ghostingMinMin: 5,
  ghostingMaxMin: 10,
  inviteRequestDelay: 2000,
  schedulerEngine: 'hybrid',
  optimizedSchedulerNamespaces: 'system-jobs,account-report-service,worker_manager',
  optimizedSchedulerTickMs: 100,
  optimizedSchedulerWheelSize: 600,
})

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

function syncLocalSettings() {
  if (settings.value) {
    localSettings.value = JSON.parse(JSON.stringify({
      accountMode: (settings.value as any).accountMode || 'main',
      harvestDelay: (settings.value as any).harvestDelay || { min: 180, max: 300 },
      plantingStrategy: settings.value.plantingStrategy,
      preferredSeedId: settings.value.preferredSeedId,
      intervals: {
        ...defaultIntervals,
        ...(settings.value.intervals || {}),
      },
      friendQuietHours: settings.value.friendQuietHours,
      stakeoutSteal: (settings.value as any).stakeoutSteal || { enabled: false, delaySec: 3 },
      tradeConfig: ((settings.value as any).tradeConfig || {}).sell
        ? {
            sell: {
              ...defaultTradeConfig.sell,
              ...(((settings.value as any).tradeConfig || {}).sell || {}),
              keepFruitIds: Array.isArray((((settings.value as any).tradeConfig || {}).sell || {}).keepFruitIds)
                ? [ ...((((settings.value as any).tradeConfig || {}).sell || {}).keepFruitIds) ]
                : [],
              rareKeep: {
                ...defaultTradeConfig.sell.rareKeep,
                ...((((((settings.value as any).tradeConfig || {}).sell || {}).rareKeep) || {})),
              },
            },
          }
        : {
        sell: {
          ...defaultTradeConfig.sell,
          keepFruitIds: [...defaultTradeConfig.sell.keepFruitIds],
          rareKeep: { ...defaultTradeConfig.sell.rareKeep },
        },
      },
      reportConfig: (settings.value as any).reportConfig || defaultReportConfig,
      automation: settings.value.automation,
    }))

    // Default automation values if missing
    if (!localSettings.value.automation) {
      localSettings.value.automation = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        landUpgradeTarget: 6,
        friend_steal: false,
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        fertilizer_buy_limit: 100,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
        // 偷菜过滤
        stealFilterEnabled: false,
        stealFilterMode: 'blacklist',
        stealFilterPlantIds: [] as number[],
        // 偷好友过滤
        stealFriendFilterEnabled: false,
        stealFriendFilterMode: 'blacklist',
        stealFriendFilterIds: [] as number[],
        friend_auto_accept: false,
        fertilizer_60s_anti_steal: false,
        fertilizer_smart_phase: false,
        fastHarvest: false,
        forceGetAllEnabled: false,
      }
    }
    else {
      // Merge with defaults to ensure all keys exist
      const defaults = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        landUpgradeTarget: 6,
        friend_steal: false,
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        fertilizer_buy_limit: 100,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
        // 偷菜过滤
        stealFilterEnabled: false,
        stealFilterMode: 'blacklist',
        stealFilterPlantIds: [] as number[],
        // 偷好友过滤
        stealFriendFilterEnabled: false,
        stealFriendFilterMode: 'blacklist',
        stealFriendFilterIds: [] as number[],
        friend_auto_accept: false,
        fertilizer_60s_anti_steal: false,
        fertilizer_smart_phase: false,
        fastHarvest: false,
        forceGetAllEnabled: false,
      }
      localSettings.value.automation = {
        ...defaults,
        ...localSettings.value.automation,
      }
    }

    if (!localSettings.value.stakeoutSteal) {
      localSettings.value.stakeoutSteal = { enabled: false, delaySec: 3 }
    }

    localSettings.value.reportConfig = {
      ...defaultReportConfig,
      ...(localSettings.value.reportConfig || {}),
    }
    localSettings.value.intervals = {
      ...defaultIntervals,
      ...(localSettings.value.intervals || {}),
    }
    const currentSellConfig = ((localSettings.value.tradeConfig || {}).sell || {}) as any
    const currentRareKeep = (currentSellConfig.rareKeep || {}) as any
    localSettings.value.tradeConfig = {
      sell: {
        ...defaultTradeConfig.sell,
        ...currentSellConfig,
        keepFruitIds: Array.isArray(currentSellConfig.keepFruitIds) ? currentSellConfig.keepFruitIds : [],
        rareKeep: {
          ...defaultTradeConfig.sell.rareKeep,
          ...currentRareKeep,
        },
      },
    }
    tradeKeepFruitIdsText.value = ((localSettings.value.tradeConfig.sell.keepFruitIds || []) as number[]).join(', ')

    // Sync offline settings (global)
    if (settings.value.offlineReminder) {
      localOffline.value = JSON.parse(JSON.stringify(settings.value.offlineReminder))
    }
  }
}

function buildSettingsPayload() {
  const payload = JSON.parse(JSON.stringify(localSettings.value))
  const ids = String(tradeKeepFruitIdsText.value || '')
    .split(/[\s,，]+/)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0)
  if (!payload.tradeConfig)
    payload.tradeConfig = { sell: {} }
  if (!payload.tradeConfig.sell)
    payload.tradeConfig.sell = {}
  payload.tradeConfig.sell.keepFruitIds = Array.from(new Set(ids))
  return payload
}

// 策略预设应用函数
function applyPreset(type: 'conservative' | 'balanced' | 'aggressive') {
  if (!window.window.confirm('应用预设将覆盖当前页面的配置（不会改变过滤名单），应用后请点击“保存”以生效。是否继续？')) {
    return
  }

  // 基础共用配置 (3 种模板共同开启项)
  const baseAutomation = {
    farm: true,
    task: true,
    sell: true,
    friend: true,
    farm_push: true,
    email: true,
    free_gifts: true,
    share_reward: true,
    vip_gift: true,
    month_card: true,
    open_server_gift: true,
    fertilizer_gift: true,
    fertilizer_buy: true,
    friend_steal: true,
    friend_help: true,
    friend_help_exp_limit: true,
  }

  if (type === 'conservative') {
    localSettings.value.intervals = {
      ...defaultIntervals,
      farmMin: 300,
      farmMax: 600,
      friendMin: 900,
      friendMax: 1200,
      helpMin: 900,
      helpMax: 1200,
      stealMin: 900,
      stealMax: 1200,
    }
    localSettings.value.friendQuietHours = { enabled: true, start: '23:00', end: '07:00' }
    localSettings.value.automation = {
      ...localSettings.value.automation,
      ...baseAutomation,
      fertilizer: 'normal',
      friend_bad: false,
      stealFilterEnabled: false,
      stealFriendFilterEnabled: false,
    }
    showAlert('已应用【保守配置】：最高安全性，建议主号使用。', 'primary')
  }
  else if (type === 'balanced') {
    localSettings.value.intervals = {
      ...defaultIntervals,
      farmMin: 180,
      farmMax: 300,
      friendMin: 600,
      friendMax: 900,
      helpMin: 600,
      helpMax: 900,
      stealMin: 600,
      stealMax: 900,
    }
    localSettings.value.friendQuietHours = { enabled: true, start: '23:00', end: '07:00' }
    localSettings.value.automation = {
      ...localSettings.value.automation,
      ...baseAutomation,
      fertilizer: 'both',
      friend_bad: false,
      stealFilterEnabled: true,
      stealFilterMode: 'blacklist',
      stealFriendFilterEnabled: true,
      stealFriendFilterMode: 'blacklist',
    }
    showAlert('已应用【平衡配置】：兼顾收益与安全，强烈推荐！', 'primary')
  }
  else if (type === 'aggressive') {
    localSettings.value.intervals = {
      ...defaultIntervals,
      farmMin: 120,
      farmMax: 180,
      friendMin: 300,
      friendMax: 600,
      helpMin: 300,
      helpMax: 600,
      stealMin: 300,
      stealMax: 600,
    }
    localSettings.value.friendQuietHours = { enabled: true, start: '00:00', end: '06:00' }
    localSettings.value.automation = {
      ...localSettings.value.automation,
      ...baseAutomation,
      fertilizer: 'both',
      friend_bad: true,
      stealFilterEnabled: true,
      stealFilterMode: 'whitelist',
      stealFriendFilterEnabled: true,
      stealFriendFilterMode: 'whitelist',
    }
    showAlert('已应用【激进配置】：极大提升收益，但也有极高风险，请谨慎点击保存。', 'primary')
  }
}

const safeChecking = ref(false)
async function handleSafeCheck() {
  if (!currentAccountId.value)
    return
  // TODO: remove confirm
  if (window.window.confirm(`是否分析当前账号的历史封禁日志并自动补充黑名单？`)) {
    try {
      safeChecking.value = true
      const res = await accountStore.applySafeModeBlacklist(currentAccountId.value)
      if (res && res.ok && res.data && res.data.length >= 0) {
        showAlert(`一键分析完成！\n新增了 ${res.data.length} 个风险账号到黑名单。\n${res.data.join(', ')}`)
      }
      else {
        showAlert('暂无新增记录。')
      }
    }
    catch (e: any) {
      showAlert(`分析失败: ${e.message}`, 'danger')
    }
    finally {
      safeChecking.value = false
    }
  }
}

async function loadData() {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    await refreshReportLogs()
    syncLocalSettings()
    // Always fetch seeds to ensure correct locked status for current account
    await farmStore.fetchSeeds(currentAccountId.value)
    // 好友过滤已开启时自动拉取好友列表
    if (localSettings.value.automation.stealFriendFilterEnabled && friends.value.length === 0) {
      friendStore.fetchFriends(currentAccountId.value)
    }
  }
  else {
    reportLogs.value = []
    reportLogPagination.value = { page: 1, pageSize: reportPageSize.value || 10, total: 0, totalPages: 1 }
    await settingStore.fetchReportLogStats('')
  }
  // 管理员加载体验卡配置
  loadTrialConfig()
  loadThirdPartyApiConfig()
  if (isAdmin.value) {
    loadTimingConfig()
    loadClusterConfig()
  }
}

onMounted(() => {
  loadData()
})

// 【关键修复】仅监听 accountId 字符串值，而非 currentAccount 对象引用
// 原因：Sidebar 每 10 秒轮询 fetchAccounts() 会替换 accounts 数组，
// 导致 currentAccount computed 返回新对象引用（即使数据内容相同），
// 从而误触发 loadData()，引发页面闪烁和滚动位置重置
watch(() => currentAccountId.value, () => {
  expandedReportLogIds.value = []
  selectedReportLogIds.value = []
  closeReportLogDetail()
  loadData()
})

// 好友过滤开关切换时自动加载好友列表
watch(() => localSettings.value.automation.stealFriendFilterEnabled, (enabled) => {
  if (enabled && currentAccountId.value && friends.value.length === 0) {
    friendStore.fetchFriends(currentAccountId.value)
  }
})

const fertilizerOptions = [
  { label: '普通 + 有机', value: 'both', description: '极速成长与改良双管齐下，全包化肥方案。' },
  { label: '仅普通化肥', value: 'normal', description: '仅在防偷等关键时刻加速生长，节约高阶成本。' },
  { label: '仅有机化肥', value: 'organic', description: '优先消耗可循环产出的有机肥改善土壤。' },
  { label: '不施肥', value: 'none', description: '佛系种植，绝不消耗任何额外物资。' },
]

const plantingStrategyOptions = [
  { label: '优先种植种子', value: 'preferred' },
  { label: '最高等级作物', value: 'level' },
  { label: '最大经验/时', value: 'max_exp' },
  { label: '最大普通肥经验/时', value: 'max_fert_exp' },
  { label: '最大净利润/时', value: 'max_profit' },
  { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
]

const channelOptions = [
  { label: 'Webhook(自定义接口)', value: 'webhook' },
  { label: 'Qmsg 酱', value: 'qmsg' },
  { label: 'Server 酱', value: 'serverchan' },
  { label: 'Push Plus', value: 'pushplus' },
  { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
  { label: '钉钉', value: 'dingtalk' },
  { label: '企业微信', value: 'wecom' },
  { label: 'Bark', value: 'bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp' },
  { label: 'OneBot', value: 'onebot' },
  { label: 'Atri', value: 'atri' },
  { label: 'PushDeer', value: 'pushdeer' },
  { label: 'iGot', value: 'igot' },
  { label: 'Telegram', value: 'telegram' },
  { label: '飞书', value: 'feishu' },
  { label: 'IFTTT', value: 'ifttt' },
  { label: '企业微信群机器人', value: 'wecombot' },
  { label: 'Discord', value: 'discord' },
  { label: 'WxPusher', value: 'wxpusher' },
]

const reloginUrlModeOptions = [
  { label: '不需要', value: 'none' },
  { label: 'QQ直链', value: 'qq_link' },
  { label: '二维码图片', value: 'qr_code' },
  { label: '直链 + 二维码', value: 'all' },
]

// 推送渠道官方文档链接
const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn',
  serverchan: 'https://sct.ftqq.com',
  pushplus: 'https://www.pushplus.plus',
  pushplushxtrip: 'https://pushplus.hxtrip.com',
  dingtalk: 'https://open.dingtalk.com/document/robots/custom-robot-access',
  wecom: 'https://developer.work.weixin.qq.com/document/path/90236',
  bark: 'https://bark.day.app',
  gocqhttp: 'https://docs.go-cqhttp.org',
  onebot: 'https://onebot.dev',
  atri: '',
  pushdeer: 'https://pushdeer.com',
  igot: 'https://igot.getui.com',
  telegram: 'https://core.telegram.org/bots/api',
  feishu: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
  ifttt: 'https://ifttt.com',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  discord: 'https://discord.com/developers/docs/resources/webhook',
  wxpusher: 'https://wxpusher.zjiecode.com',
}

const channelDocUrl = computed(() => {
  return CHANNEL_DOCS[localOffline.value.channel] || ''
})

const reportChannelDocUrl = computed(() => {
  return CHANNEL_DOCS[localSettings.value.reportConfig.channel] || ''
})

const preferredSeedOptions = computed(() => {
  const options = [{ label: '自动选择', value: 0 }]
  if (seeds.value) {
    options.push(...seeds.value.map(seed => ({
      label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
      value: seed.seedId,
      disabled: seed.locked || seed.soldOut,
    })))
  }
  return options
})

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

const strategyPreviewLabel = ref<string | null>(null)

watchEffect(async () => {
  const strategy = localSettings.value.plantingStrategy
  if (strategy === 'preferred') {
    strategyPreviewLabel.value = null
    return
  }
  if (!seeds.value || seeds.value.length === 0) {
    strategyPreviewLabel.value = null
    return
  }
  const available = seeds.value.filter(s => !s.locked && !s.soldOut)
  if (available.length === 0) {
    strategyPreviewLabel.value = '暂无可用种子'
    return
  }
  if (strategy === 'level') {
    const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
    strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
    return
  }
  const sortBy = analyticsSortByMap[strategy]
  if (sortBy) {
    try {
      const res = await api.get(`/api/analytics?sort=${sortBy}`)
      const rankings: any[] = res.data.ok ? (res.data.data || []) : []
      const availableIds = new Set(available.map(s => s.seedId))
      const match = rankings.find(r => availableIds.has(Number(r.seedId)))
      if (match) {
        const seed = available.find(s => s.seedId === Number(match.seedId))
        strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
      }
      else {
        strategyPreviewLabel.value = '暂无匹配种子'
      }
    }
    catch {
      strategyPreviewLabel.value = null
    }
  }
})

const diffModalVisible = ref(false)
const diffItems = ref<{ label: string, from: string, to: string }[]>([])

// 翻译映射
const fieldLabels: Record<string, string> = {
  farm: '自动种植收获',
  task: '自动完成任务',
  sell: '自动卖果实',
  friend: '自动好友互动',
  farm_push: '推送触发巡田',
  land_upgrade: '自动升级土地',
  landUpgradeTarget: '土地升级目标等级',
  friend_steal: '自动偷菜',
  friend_help: '自动帮忙',
  friend_bad: '自动捣乱',
  friend_auto_accept: '自动同意好友',
  friend_help_exp_limit: '经验上限停止帮忙',
  forceGetAllEnabled: '强制好友兼容模式',
  email: '自动领取邮件',
  fertilizer_gift: '自动填充化肥',
  fertilizer_buy: '自动购买化肥',
  fertilizer_60s_anti_steal: '60秒施肥(防偷)',
  fastHarvest: '成熟秒收取',
  free_gifts: '自动商城礼包',
  share_reward: '自动分享奖励',
  vip_gift: '自动VIP礼包',
  month_card: '自动月卡奖励',
  open_server_gift: '自动开服红包',
  fertilizer: '施肥策略',
  plantingStrategy: '种植策略',
  preferredSeedId: '优先种植种子',
}

function getValLabel(field: string, val: any) {
  if (typeof val === 'boolean')
    return val ? '开启' : '关闭'
  if (field === 'fertilizer') {
    return fertilizerOptions.find(o => o.value === val)?.label || val
  }
  if (field === 'plantingStrategy') {
    return plantingStrategyOptions.find(o => o.value === val)?.label || val
  }
  if (field === 'preferredSeedId') {
    return preferredSeedOptions.value.find(o => o.value === val)?.label || val
  }
  return String(val)
}

async function saveAccountSettings(force: any = false) {
  if (!currentAccountId.value)
    return
  const isForce = force === true

  // 计算差异 (排除列表类字段，仅对比基础开关和策略)
  if (!isForce && settings.value) {
    const changes: any[] = []
    const oldAuto = settings.value.automation || {}
    const newAuto = localSettings.value.automation || {}

    // 对比基础策略
    ;['accountMode', 'plantingStrategy', 'preferredSeedId'].forEach((key) => {
      const oldVal = (settings.value as any)[key]
      const newVal = (localSettings.value as any)[key]
      if (oldVal !== newVal) {
        const _label = fieldLabels[key] || key
        changes.push({ label: _label, from: getValLabel(key, oldVal), to: getValLabel(key, newVal) })
      }
    })

    // 对比状态
    Object.keys(fieldLabels).forEach((key) => {
      const oldAutoVal = (oldAuto as any)[key]
      const newAutoVal = (newAuto as any)[key]
      if (newAutoVal !== undefined) {
        if (oldAutoVal !== newAutoVal) {
          changes.push({ label: fieldLabels[key], from: getValLabel(key, oldAutoVal), to: getValLabel(key, newAutoVal) })
        }
      }
    })

    // 对比蹲守配置
    const oldStake = (settings.value as any).stakeoutSteal || {}
    const newStake = localSettings.value.stakeoutSteal || {}
    if (oldStake.enabled !== newStake.enabled) {
      changes.push({ label: '精准蹲守偷菜', from: getValLabel('stakeoutSteal', !!oldStake.enabled), to: getValLabel('stakeoutSteal', !!newStake.enabled) })
    }

    if (changes.length > 0) {
      diffItems.value = changes
      diffModalVisible.value = true
      return
    }
  }

  diffModalVisible.value = false
  saving.value = true
  try {
    const res = await settingStore.saveSettings(currentAccountId.value, buildSettingsPayload())
    if (res.ok) {
      showAlert('账号设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    saving.value = false
  }
}

async function handleChangePassword() {
  if (!passwordForm.value.old || !passwordForm.value.new) {
    showAlert('请填写完整', 'danger')
    return
  }
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    showAlert('两次密码输入不一致', 'danger')
    return
  }
  // 管理员：≥4 位；普通用户：≥6 位 + 字母数字（后端会二次校验）
  const minLen = isAdmin.value ? 4 : 6
  if (passwordForm.value.new.length < minLen) {
    showAlert(`密码长度至少 ${minLen} 位`, 'danger')
    return
  }

  passwordSaving.value = true
  try {
    const res = await settingStore.changePassword(passwordForm.value.old, passwordForm.value.new)

    if (res.ok) {
      showAlert(`用户 ${currentUsername.value} 密码修改成功`)
      passwordForm.value = { old: '', new: '', confirm: '' }
    }
    else {
      showAlert(`修改失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    passwordSaving.value = false
  }
}

async function handleSaveOffline() {
  offlineSaving.value = true
  try {
    const res = await settingStore.saveOfflineConfig(localOffline.value)

    if (res.ok) {
      showAlert('下线提醒设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    offlineSaving.value = false
  }
}

async function handleSendReportTest() {
  if (!currentAccountId.value)
    return
  reportTesting.value = true
  try {
    const saveRes = await settingStore.saveSettings(currentAccountId.value, buildSettingsPayload())
    if (!saveRes.ok) {
      showAlert(`保存汇报配置失败: ${saveRes.error || '未知错误'}`, 'danger')
      return
    }

    const res = await settingStore.sendReportTest(currentAccountId.value)
    if (res.ok) {
      await refreshReportLogs()
      showAlert('测试汇报已发送，请检查目标渠道')
    }
    else {
      showAlert(`测试发送失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    reportTesting.value = false
  }
}

async function handleSendReport(mode: 'hourly' | 'daily') {
  if (!currentAccountId.value)
    return
  reportSendingMode.value = mode
  try {
    const saveRes = await settingStore.saveSettings(currentAccountId.value, buildSettingsPayload())
    if (!saveRes.ok) {
      showAlert(`保存汇报配置失败: ${saveRes.error || '未知错误'}`, 'danger')
      return
    }

    const res = await settingStore.sendReport(currentAccountId.value, mode)
    if (res.ok) {
      await refreshReportLogs()
      showAlert(mode === 'hourly' ? '小时汇报已发送' : '日报已发送')
    }
    else {
      showAlert(`发送失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    reportSendingMode.value = ''
  }
}

async function refreshReportLogs(options: { page?: number, pageSize?: number, resetPage?: boolean } = {}) {
  if (!currentAccountId.value)
    return
  reportHistoryLoading.value = true
  try {
    const targetPage = options.resetPage ? 1 : (options.page || reportLogPagination.value.page || 1)
    const targetPageSize = options.pageSize || reportPageSize.value || 10
    const requestOptions = {
      mode: reportFilters.value.mode,
      status: reportFilters.value.status,
      sortOrder: reportSortOrder.value,
      keyword: reportKeyword.value.trim(),
    }
    await Promise.all([
      settingStore.fetchReportLogs(currentAccountId.value, {
        page: targetPage,
        pageSize: targetPageSize,
        ...requestOptions,
      }),
      settingStore.fetchReportLogStats(currentAccountId.value, requestOptions),
    ])
    reportPageSize.value = reportLogPagination.value.pageSize || reportPageSize.value || 10
  }
  finally {
    reportHistoryLoading.value = false
  }
}

async function goToReportLogPage(page: number) {
  if (!currentAccountId.value)
    return
  if (page < 1 || page > (reportLogPagination.value.totalPages || 1))
    return
  await refreshReportLogs({ page })
}

async function handleClearReportLogs() {
  if (!currentAccountId.value)
    return
  if (!window.window.confirm('是否清空当前账号的全部经营汇报历史记录？此操作不可恢复。'))
    return
  reportHistoryClearing.value = true
  try {
    const res = await settingStore.clearReportLogs(currentAccountId.value)
    if (res.ok) {
      await refreshReportLogs({ resetPage: true })
      showAlert('经营汇报历史已清空')
    }
    else {
      showAlert(`清空失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    reportHistoryClearing.value = false
  }
}

async function handleExportReportLogs() {
  if (!currentAccountId.value)
    return
  reportHistoryExporting.value = true
  try {
    const res = await settingStore.exportReportLogs(currentAccountId.value, {
      mode: reportFilters.value.mode,
      status: reportFilters.value.status,
      sortOrder: reportSortOrder.value,
      keyword: reportKeyword.value.trim(),
    })
    if (!res.ok || !res.blob) {
      showAlert(`导出失败: ${res.error || '未知错误'}`, 'danger')
      return
    }
    const url = window.URL.createObjectURL(res.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = res.filename || 'report-history.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
    if (res.truncated) {
      showAlert(`导出完成：已导出 ${res.count} 条记录（当前筛选共 ${res.total} 条，导出上限 2000 条）`)
    }
    else {
      showAlert(`导出完成：已导出 ${res.count} 条记录`)
    }
  }
  finally {
    reportHistoryExporting.value = false
  }
}

async function handleApplyReportSearch() {
  expandedReportLogIds.value = []
  selectedReportLogIds.value = []
  closeReportLogDetail()
  await refreshReportLogs({ resetPage: true })
}

async function handleShowLatestFailed() {
  reportFilters.value.status = 'failed'
  reportSortOrder.value = 'desc'
  reportKeyword.value = ''
  await handleApplyReportSearch()
}

async function handleResetReportHistoryView() {
  reportFilters.value = { mode: 'all', status: 'all' }
  reportKeyword.value = ''
  reportSortOrder.value = 'desc'
  reportPageSize.value = 10
  await handleApplyReportSearch()
}

async function handleReportStatsCardClick(key: string) {
  const previous = {
    mode: reportFilters.value.mode,
    status: reportFilters.value.status,
    sortOrder: reportSortOrder.value,
  }

  if (key === 'total') {
    reportFilters.value = { mode: 'all', status: 'all' }
    reportSortOrder.value = 'desc'
  }
  else if (key === 'success') {
    reportFilters.value = { ...reportFilters.value, status: 'success' }
    reportSortOrder.value = 'desc'
  }
  else if (key === 'failed') {
    reportFilters.value = { ...reportFilters.value, status: 'failed' }
    reportSortOrder.value = 'desc'
  }
  else if (key === 'test' || key === 'hourly' || key === 'daily') {
    reportFilters.value = { ...reportFilters.value, mode: key }
    reportSortOrder.value = 'desc'
  }
  else {
    return
  }

  const changed = previous.mode !== reportFilters.value.mode
    || previous.status !== reportFilters.value.status
    || previous.sortOrder !== reportSortOrder.value

  if (!changed)
    await refreshReportLogs({ resetPage: true })
}

function isReportLogSelected(id: number) {
  return selectedReportLogIds.value.includes(id)
}

function toggleReportLogSelected(id: number) {
  if (isReportLogSelected(id)) {
    selectedReportLogIds.value = selectedReportLogIds.value.filter(itemId => itemId !== id)
  }
  else {
    selectedReportLogIds.value = [...selectedReportLogIds.value, id]
  }
}

function toggleSelectAllVisibleReportLogs() {
  if (allVisibleReportLogsSelected.value) {
    const visibleIds = new Set(reportLogs.value.map(item => item.id))
    selectedReportLogIds.value = selectedReportLogIds.value.filter(id => !visibleIds.has(id))
  }
  else {
    const next = new Set(selectedReportLogIds.value)
    for (const item of reportLogs.value) {
      next.add(item.id)
    }
    selectedReportLogIds.value = Array.from(next)
  }
}

async function refreshReportLogsAfterDelete(deletedIds: number[]) {
  const visibleDeletedCount = reportLogs.value.filter(item => deletedIds.includes(item.id)).length
  const currentPage = reportLogPagination.value.page || 1
  const shouldFallbackPage = visibleDeletedCount >= reportLogs.value.length && currentPage > 1
  await refreshReportLogs({ page: shouldFallbackPage ? currentPage - 1 : currentPage })
  if (reportLogs.value.length === 0 && (reportLogPagination.value.page || 1) > 1) {
    await refreshReportLogs({ page: (reportLogPagination.value.page || 1) - 1 })
  }
}

async function handleDeleteReportLogs(ids: number[], options: { single?: boolean, title?: string } = {}) {
  if (!currentAccountId.value)
    return
  const normalizedIds = Array.from(new Set(ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)))
  if (normalizedIds.length === 0)
    return
  const titleText = options.title || (options.single ? '这条汇报记录' : `这 ${normalizedIds.length} 条汇报记录`)
  if (!window.window.confirm(`是否删除${titleText}？此操作不可恢复。`))
    return

  if (options.single) {
    reportHistoryDeletingIds.value = normalizedIds
  }
  else {
    reportHistoryBatchDeleting.value = true
  }

  try {
    const res = await settingStore.deleteReportLogsByIds(currentAccountId.value, normalizedIds)
    if (!res.ok) {
      showAlert(`删除失败: ${res.error || '未知错误'}`, 'danger')
      return
    }
    selectedReportLogIds.value = selectedReportLogIds.value.filter(id => !normalizedIds.includes(id))
    if (reportDetailItem.value && normalizedIds.includes(reportDetailItem.value.id)) {
      closeReportLogDetail()
    }
    await refreshReportLogsAfterDelete(normalizedIds)
    showAlert(options.single ? '汇报记录已删除' : `已删除 ${normalizedIds.length} 条汇报记录`)
  }
  finally {
    reportHistoryDeletingIds.value = reportHistoryDeletingIds.value.filter(id => !normalizedIds.includes(id))
    reportHistoryBatchDeleting.value = false
  }
}

function formatReportMode(mode: string) {
  if (mode === 'hourly')
    return '小时汇报'
  if (mode === 'daily')
    return '日报'
  return '测试汇报'
}

function formatReportLogTime(value: string) {
  if (!value)
    return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return String(value)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function getReportLogPreview(content: string) {
  const text = String(content || '').trim()
  if (!text)
    return '无正文'
  const lines = text.split('\n')
  if (lines.length > 4)
    return `${lines.slice(0, 4).join('\n')}\n...`
  if (text.length > 220)
    return `${text.slice(0, 220)}...`
  return text
}

function isReportLogExpanded(id: number) {
  return expandedReportLogIds.value.includes(id)
}

function toggleReportLogExpanded(id: number) {
  if (isReportLogExpanded(id)) {
    expandedReportLogIds.value = expandedReportLogIds.value.filter(itemId => itemId !== id)
  }
  else {
    expandedReportLogIds.value = [...expandedReportLogIds.value, id]
  }
}

function openReportLogDetail(item: ReportLogEntry) {
  reportDetailItem.value = { ...item }
  reportDetailVisible.value = true
}

function closeReportLogDetail() {
  reportDetailVisible.value = false
  reportDetailItem.value = null
}

watch(() => [reportFilters.value.mode, reportFilters.value.status, reportSortOrder.value], () => {
  expandedReportLogIds.value = []
  selectedReportLogIds.value = []
  closeReportLogDetail()
  if (!currentAccountId.value)
    return
  void refreshReportLogs({ resetPage: true })
})

watch(() => reportPageSize.value, (pageSize, prevPageSize) => {
  expandedReportLogIds.value = []
  selectedReportLogIds.value = []
  closeReportLogDetail()
  if (!currentAccountId.value)
    return
  if (pageSize === prevPageSize)
    return
  void refreshReportLogs({ resetPage: true, pageSize: pageSize || 10 })
})

watch(() => reportLogs.value.map(item => item.id).join(','), () => {
  const visibleIds = new Set(reportLogs.value.map(item => item.id))
  expandedReportLogIds.value = expandedReportLogIds.value.filter(id => visibleIds.has(id))
  selectedReportLogIds.value = selectedReportLogIds.value.filter(id => visibleIds.has(id))
  reportHistoryDeletingIds.value = reportHistoryDeletingIds.value.filter(id => visibleIds.has(id))
  if (reportDetailItem.value && !visibleIds.has(reportDetailItem.value.id)) {
    closeReportLogDetail()
  }
})

watch(
  () => [reportFilters.value.mode, reportFilters.value.status, reportKeyword.value, reportSortOrder.value, reportPageSize.value],
  ([mode, status, keyword, sortOrder, pageSize]) => {
    try {
      localStorage.setItem(REPORT_HISTORY_VIEW_STORAGE_KEY, JSON.stringify({
        mode,
        status,
        keyword: String(keyword || '').slice(0, 100),
        sortOrder,
        pageSize,
      }))
    }
    catch {
      // ignore localStorage write failures
    }
  },
  { immediate: true },
)

async function loadTimingConfig() {
  if (!isAdmin.value)
    return
  const data = await settingStore.fetchTimingConfig()
  if (data && data.config) {
    localTiming.value = {
      ...localTiming.value,
      ...(data.defaults || {}),
      ...(data.config || {}),
    }
  }
}

async function handleSaveTiming() {
  // 数据合法性校验，防止输入空字符串或非法字符导致的保存失败
  const t = localTiming.value
  const isValid = !Number.isNaN(t.heartbeatIntervalMs) && !Number.isNaN(t.rateLimitIntervalMs)
    && !Number.isNaN(t.ghostingProbability) && !Number.isNaN(t.ghostingCooldownMin)
    && !Number.isNaN(t.ghostingMinMin) && !Number.isNaN(t.ghostingMaxMin)
    && !Number.isNaN(t.inviteRequestDelay)
    && !Number.isNaN(t.optimizedSchedulerTickMs)
    && !Number.isNaN(t.optimizedSchedulerWheelSize)
    && !!String(t.schedulerEngine || '').trim()

  if (!isValid) {
    showAlert('保存失败：请确保所有项均为有效数字', 'danger')
    return
  }

  timingSaving.value = true
  try {
    const res = await settingStore.saveTimingConfig(localTiming.value)
    if (res.ok) {
      showAlert('时间参数配置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    timingSaving.value = false
  }
}

async function restoreTimingDefaults() {
  localTiming.value = { ...settingStore.settings.defaultTimingConfig }
  showAlert('已加载默认推荐值，点击保存后生效')
}
</script>

<template>
  <div class="settings-page">
    <div v-if="loading" class="glass-text-muted py-4 text-center">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="grid grid-cols-1 mt-12 gap-4 text-sm lg:grid-cols-2">
      <!-- Card 1: Strategy & Automation -->
      <div v-if="currentAccountId" class="card glass-panel h-full flex flex-col rounded-lg shadow">
        <!-- Strategy Header -->
        <div class="flex flex-col justify-between gap-3 border-b border-white/20 bg-transparent px-4 py-3 md:flex-row md:items-center dark:border-white/10">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-fas-cogs" />
            策略设置
            <span v-if="currentAccountName" class="glass-text-muted text-sm font-normal">
              ({{ currentAccountName }})
            </span>
          </h3>
          <!-- 预设配置快捷组 -->
          <div class="flex flex-wrap items-center gap-2">
            <span class="glass-text-muted mr-1 hidden text-xs lg:inline-block">预设:</span>
            <button
              class="flex items-center gap-1 border border-primary-200 rounded-md bg-primary-50 px-2 py-1 text-xs text-primary-700 font-semibold transition dark:border-primary-800/50 dark:bg-primary-900/20 hover:bg-primary-100 dark:text-primary-400 dark:hover:bg-primary-900/40"
              title="安全优先，最像真人"
              @click="applyPreset('conservative')"
            >
              <div class="i-carbon-security" /> 保守
            </button>
            <button
              class="flex items-center gap-1 border border-blue-200 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 font-semibold transition dark:border-blue-800/50 dark:bg-blue-900/20 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/40"
              title="推荐配置，收益与安全并重"
              @click="applyPreset('balanced')"
            >
              <div class="i-carbon-scales" /> 平衡
            </button>
            <button
              class="flex items-center gap-1 border border-orange-200 rounded-md bg-orange-50 px-2 py-1 text-xs text-orange-700 font-semibold transition dark:border-orange-800/50 dark:bg-orange-900/20 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/40"
              title="收益优先，适合小号跑图"
              @click="applyPreset('aggressive')"
            >
              <div class="i-carbon-rocket" /> 激进
            </button>

            <div class="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-600" />

            <BaseButton
              variant="primary"
              size="sm"
              :loading="saving"
              class="flex items-center gap-1 text-xs !h-auto !px-3 !py-1"
              @click="saveAccountSettings"
            >
              <div class="i-carbon-save" /> 快速保存
            </BaseButton>
          </div>
        </div>

        <!-- Strategy Content -->
        <div class="p-4 space-y-3">
          <!-- Account Mode Selection Panel -->
          <div class="grid grid-cols-1 mb-4 gap-3 md:grid-cols-3">
            <!-- 主号模式 -->
            <div
              class="cursor-pointer border border-gray-200 rounded-lg bg-white p-3 transition-all duration-200 dark:border-gray-700 hover:border-primary-400 dark:bg-gray-800 dark:hover:border-primary-500"
              :class="{ 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20 border-primary-500 dark:border-primary-500': localSettings.accountMode === 'main' }"
              @click="localSettings.accountMode = 'main'"
            >
              <div class="mb-1 flex items-center justify-between">
                <div class="flex items-center gap-1 text-primary-600 font-bold dark:text-primary-400">
                  <div class="i-carbon-user-avatar items-center" /> 主号模式
                </div>
                <div v-show="localSettings.accountMode === 'main'" class="i-carbon-checkmark-filled text-primary-500" />
              </div>
              <div class="text-xs text-gray-500 leading-tight dark:text-gray-400">
                享有全部操作权限（如成熟秒收），系统确保主号的优先度和唯一性
              </div>
            </div>
            <!-- 小号模式 -->
            <div
              class="cursor-pointer border border-gray-200 rounded-lg bg-white p-3 transition-all duration-200 dark:border-gray-700 hover:border-amber-400 dark:bg-gray-800 dark:hover:border-amber-500"
              :class="{ 'ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-900/20 border-amber-500 dark:border-amber-500': localSettings.accountMode === 'alt' }"
              @click="localSettings.accountMode = 'alt'"
            >
              <div class="mb-1 flex items-center justify-between">
                <div class="flex items-center gap-1 text-amber-600 font-bold dark:text-amber-400">
                  <div class="i-carbon-user-multiple items-center" /> 小号模式
                </div>
                <div v-show="localSettings.accountMode === 'alt'" class="i-carbon-checkmark-filled text-amber-500" />
              </div>
              <div class="text-xs text-gray-500 leading-tight dark:text-gray-400">
                限制可能招致仇恨的操作，强制引入延迟收获机制错开高峰
              </div>
            </div>
            <!-- 风险规避模式 -->
            <div
              class="cursor-pointer border border-gray-200 rounded-lg bg-white p-3 transition-all duration-200 dark:border-gray-700 hover:border-emerald-400 dark:bg-gray-800 dark:hover:border-emerald-500"
              :class="{ 'ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500 dark:border-emerald-500': localSettings.accountMode === 'safe' }"
              @click="localSettings.accountMode = 'safe'"
            >
              <div class="mb-1 flex items-center justify-between">
                <div class="flex items-center gap-1 text-emerald-600 font-bold dark:text-emerald-400">
                  <div class="i-carbon-security items-center" /> 风险规避
                </div>
                <div v-show="localSettings.accountMode === 'safe'" class="i-carbon-checkmark-filled text-emerald-500" />
              </div>
              <div class="text-xs text-gray-500 leading-tight dark:text-gray-400">
                严格禁用高风险互动，自动脱离黑灰产关联，专用于敏感期
              </div>
            </div>
          </div>

          <!-- 小号模式特供区：假延迟 -->
          <div v-if="localSettings.accountMode === 'alt'" class="mb-4 flex flex-col gap-2 border border-amber-200 rounded-md bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
            <h4 class="flex items-center gap-1 text-sm text-amber-700 font-semibold dark:text-amber-400">
              <div class="i-carbon-time" /> 小号专属：收获延迟保护
            </h4>
            <span class="text-xs text-amber-600 dark:text-amber-500">当农作物成熟时，主动挂机并在随机延时后才收获，降低被风控或连带标记的概率。</span>
            <div class="grid grid-cols-2 mt-2 gap-3 md:grid-cols-4">
              <BaseInput
                v-model.number="localSettings.harvestDelay.min"
                label="随机延迟下限 (秒)"
                type="number"
                min="0"
              />
              <BaseInput
                v-model.number="localSettings.harvestDelay.max"
                label="随机延迟上限 (秒)"
                type="number"
                min="10"
              />
            </div>
          </div>

          <!-- 风险规避特供区：一键分析拦截 -->
          <div v-if="localSettings.accountMode === 'safe'" class="mb-4 flex flex-col items-start gap-2 border border-emerald-200 rounded-md bg-emerald-50 p-3 dark:border-emerald-800/50 dark:bg-emerald-900/20">
            <h4 class="flex items-center gap-1 text-sm text-emerald-700 font-semibold dark:text-emerald-400">
              <div class="i-carbon-ibm-cloud-security-compliance-center" /> 风险规避专属护盾
            </h4>
            <span class="text-xs text-emerald-600 dark:text-emerald-500">此模式除自动关闭捣乱接口外，可进一步针对历史出现被封警告的号外置强阻断。</span>
            <BaseButton
              variant="outline"
              size="sm"
              class="mt-1 border-emerald-300 text-emerald-600 dark:border-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-800/50"
              :loading="safeChecking"
              @click="handleSafeCheck"
            >
              <div class="i-carbon-search mr-1" /> 分析并加入防御名单
            </BaseButton>
          </div>

          <!-- 极值警告 -->
          <div v-if="timeWarningVisible && !isAdmin" class="mb-3 flex items-start gap-2 border border-red-200 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <div class="i-carbon-warning-alt mt-0.5 shrink-0 text-lg" />
            <div>
              <strong>危险的轮询设定！</strong><br>
              农田循环下限不能低于 15秒，好友/帮忙/偷菜巡查不能低于 60秒，否则极易触发腾讯风控致使账号被封。请上调参数后再保存！
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BaseSelect
              v-model="localSettings.plantingStrategy"
              label="种植策略"
              :options="plantingStrategyOptions"
            />
            <BaseSelect
              v-if="localSettings.plantingStrategy === 'preferred'"
              v-model="localSettings.preferredSeedId"
              label="优先种植种子"
              :options="preferredSeedOptions"
            />
            <div v-else class="flex flex-col gap-1">
              <span class="glass-text-muted text-xs">策略选种预览</span>
              <div class="h-9 flex items-center border border-gray-200 rounded-md bg-gray-50/80 px-3 text-sm text-blue-600 font-bold dark:border-gray-600 dark:bg-gray-700/50 dark:text-blue-400">
                <div class="i-carbon-checkmark-filled mr-1.5 text-primary-500" />
                {{ strategyPreviewLabel ?? '加载中...' }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 items-end gap-3 md:grid-cols-4 xl:grid-cols-6">
            <BaseInput
              v-model.number="localSettings.intervals.farmMin"
              label="农场巡查最小 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.farmMax"
              label="农场巡查最大 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.friendMin"
              label="好友巡查最小 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.friendMax"
              label="好友巡查最大 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.helpMin"
              label="帮忙最小 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.helpMax"
              label="帮忙最大 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.stealMin"
              label="偷菜最小 (秒)"
              type="number"
              min="1"
            />
            <BaseInput
              v-model.number="localSettings.intervals.stealMax"
              label="偷菜最大 (秒)"
              type="number"
              min="1"
            />
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
            <BaseSwitch
              v-model="localSettings.friendQuietHours.enabled"
              label="启用静默时段"
            />
            <div class="flex items-center gap-2">
              <BaseInput
                v-model="localSettings.friendQuietHours.start"
                type="time"
                class="w-24"
                :disabled="!localSettings.friendQuietHours.enabled"
              />
              <span class="glass-text-muted">-</span>
              <BaseInput
                v-model="localSettings.friendQuietHours.end"
                type="time"
                class="w-24"
                :disabled="!localSettings.friendQuietHours.enabled"
              />
            </div>
          </div>

          <div class="mt-4 border-t pt-4 dark:border-gray-700">
            <div class="mb-3">
              <h4 class="text-sm font-semibold">
                出售策略
              </h4>
              <p class="mt-1 text-xs text-gray-500">
                当前自动出售仅作用于果实类物品。可配置保留数量、指定白名单以及稀有果实保留规则。
              </p>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <BaseInput
                v-model.number="localSettings.tradeConfig.sell.keepMinEachFruit"
                label="每种果实至少保留"
                type="number"
                min="0"
              />
              <BaseInput
                v-model.number="localSettings.tradeConfig.sell.batchSize"
                label="出售批大小"
                type="number"
                min="1"
                max="50"
              />
              <BaseSelect
                v-model="localSettings.tradeConfig.sell.rareKeep.judgeBy"
                label="稀有判定方式"
                :options="[
                  { label: '任一条件命中', value: 'either' },
                  { label: '按作物等级', value: 'plant_level' },
                  { label: '按果实单价', value: 'unit_price' },
                ]"
              />
            </div>

            <div class="mt-3">
              <label class="mb-1 block text-xs text-gray-500 font-semibold">
                强制保留果实 ID（逗号或空格分隔）
              </label>
              <textarea
                v-model="tradeKeepFruitIdsText"
                rows="2"
                class="w-full border border-gray-200 rounded-lg bg-white/70 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40"
                placeholder="例如：2001, 2002, 2003"
              />
            </div>

            <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="rounded-xl border border-gray-200/70 p-4 dark:border-gray-700/70">
                <BaseSwitch
                  v-model="localSettings.tradeConfig.sell.rareKeep.enabled"
                  label="启用稀有果实保留"
                />
                <div class="mt-3 grid grid-cols-2 gap-3">
                  <BaseInput
                    v-model.number="localSettings.tradeConfig.sell.rareKeep.minPlantLevel"
                    label="最低作物等级"
                    type="number"
                    min="0"
                    :disabled="!localSettings.tradeConfig.sell.rareKeep.enabled"
                  />
                  <BaseInput
                    v-model.number="localSettings.tradeConfig.sell.rareKeep.minUnitPrice"
                    label="最低单价"
                    type="number"
                    min="0"
                    :disabled="!localSettings.tradeConfig.sell.rareKeep.enabled"
                  />
                </div>
              </div>

              <div class="rounded-xl border border-gray-200/70 p-4 dark:border-gray-700/70">
                <BaseSwitch
                  v-model="localSettings.tradeConfig.sell.previewBeforeManualSell"
                  label="手动出售前先刷新预览"
                />
                <p class="mt-2 text-xs text-gray-500">
                  背包页手动出售时会先刷新出售计划，避免在你改动保留策略后直接误卖。
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Auto Control Header -->
        <div class="border-b border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-fas-toggle-on" />
            自动控制
          </h3>
        </div>

        <!-- Auto Control Content -->
        <div class="flex-1 p-6 space-y-8">
          <!-- 分组网格 -->
          <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 md:grid-cols-2">
            <!-- 分组 1: 农场基础操作 -->
            <div class="border border-gray-100/50 rounded-2xl bg-transparent p-5 transition-all dark:border-gray-700/50 hover:bg-gray-50/10">
              <h4 class="glass-text-muted mb-4 flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-agriculture-analytics mr-2" /> 农场基础操作
                <BaseTooltip text="农场自动化的核心控制区，包含种植收获、好友互动、升级土地等基础功能" />
              </h4>
              <div class="space-y-4">
                <BaseSwitch v-model="localSettings.automation.farm" label="自动种植收获" hint="核心总开关。自动巡查农场：成熟即收、空地即种、异常即处理（浇水/除草/除虫/铲除枯死）。关闭后所有农场自动化停止。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.friend" label="自动好友互动" hint="好友巡查总开关。开启后按下方子策略遍历好友农场执行操作（偷菜/帮忙/捣乱）。关闭则所有好友互动停止。" recommend="on" />
                <div class="flex flex-col gap-2">
                  <BaseSwitch v-model="localSettings.automation.land_upgrade" label="自动升级土地" hint="金币充足且满足条件时自动升级土地等级，可提高产量。升级花费较大，金币紧张时建议关闭。" recommend="conditional" />
                  <div v-show="localSettings.automation.land_upgrade" class="ml-7 space-y-1">
                    <div class="flex items-center gap-2">
                      <span class="glass-text-muted shrink-0 text-[11px] font-bold tracking-widest uppercase">
                        最高升级到：
                      </span>
                      <BaseInput
                        v-model.number="localSettings.automation.landUpgradeTarget"
                        type="number"
                        min="0"
                        max="6"
                        class="w-16 shrink-0 text-sm shadow-inner !py-1"
                      />
                    </div>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400">0=普通，6=蓝宝石</p>
                  </div>
                </div>
                <BaseSwitch v-model="localSettings.automation.sell" label="自动卖果实" hint="收获后自动将仓库中的果实出售换取金币。关闭则果实堆积在仓库不处理。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.farm_push" label="推送触发巡田" hint="收到外部事件（如消息推送）时立即触发一次农场巡查，而非等待定时轮询，提高响应灵敏度。" recommend="on" />
              </div>
            </div>

            <!-- 分组 2: 每日收益领取 -->
            <div class="border border-gray-100/50 rounded-2xl bg-transparent p-5 transition-all dark:border-gray-700/50 hover:bg-gray-50/10">
              <h4 class="glass-text-muted mb-4 flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-gift mr-2" /> 每日收益领取
                <BaseTooltip text="每日可领取的免费奖励，建议全部开启以最大化日常收益" />
              </h4>
              <div class="space-y-4">
                <BaseSwitch v-model="localSettings.automation.free_gifts" label="自动商城礼包" hint="每日自动领取商城中的免费礼包（种子/化肥/装饰等），错过后次日才能再领。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.task" label="自动完成任务" hint="自动完成每日任务并领取奖励（金币/经验/道具），是经验和金币的重要来源。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.share_reward" label="自动分享奖励" hint="自动触发分享操作并领取分享奖励，某些活动需分享才能获取额外收益。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.email" label="自动领取邮件" hint="自动领取系统邮件中的附件奖励（活动奖励/补偿/系统礼品等）。" recommend="on" />
                <div class="grid grid-cols-1 gap-4 pt-1">
                  <BaseSwitch v-model="localSettings.automation.vip_gift" label="自动VIP礼包" hint="VIP 用户专属，自动领取每日 VIP 礼包。非 VIP 用户开启无效但不会报错。" recommend="conditional" />
                  <BaseSwitch v-model="localSettings.automation.month_card" label="自动月卡奖励" hint="月卡用户专属，自动领取月卡每日奖励。无月卡开启无效但不会报错。" recommend="conditional" />
                  <BaseSwitch v-model="localSettings.automation.open_server_gift" label="自动开服红包" hint="自动领取开服活动红包奖励。活动期间有效，非活动期开启无影响。" recommend="on" />
                </div>
              </div>
            </div>

            <!-- 分组 3: 化肥与杂项控制 -->
            <div class="border border-gray-100/50 rounded-2xl bg-transparent p-5 transition-all dark:border-gray-700/50 hover:bg-gray-50/10">
              <h4 class="glass-text-muted mb-4 flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-tool-box mr-2" /> 化肥与精细控制
                <BaseTooltip text="化肥管理和高级防盗功能的精细控制区" />
              </h4>
              <div class="space-y-4">
                <BaseSwitch v-model="localSettings.automation.fertilizer_gift" label="自动填充化肥" hint="有免费化肥领取机会时自动领取，保证化肥库存不断档。" recommend="on" />
                <div class="flex flex-col gap-2">
                  <BaseSwitch v-model="localSettings.automation.fertilizer_buy" label="自动购买化肥" hint="化肥库存不足时自动花费金币购买。注意：会持续消耗金币，金币紧张时建议关闭。" recommend="conditional" />
                  <div v-show="localSettings.automation.fertilizer_buy" class="ml-7 flex items-center gap-3">
                    <span class="glass-text-muted text-[11px] font-bold tracking-widest uppercase">
                      - 单日最大购买上限 (包)：
                    </span>
                    <BaseInput
                      v-model.number="localSettings.automation.fertilizer_buy_limit"
                      type="number"
                      min="1"
                      class="w-24 text-sm shadow-inner !py-1"
                    />
                  </div>
                </div>
                <BaseSwitch v-model="localSettings.automation.fertilizer_60s_anti_steal" label="60秒施肥(防偷)" hint="核心防盗功能。在果实成熟前60秒内自动施肥催熟并瞬间收获，将被偷窗口压缩到接近0。需消耗化肥，主号必开。" recommend="on" />
                <BaseSwitch v-model="localSettings.automation.fastHarvest" label="成熟秒收取" hint="在作物进入成熟前预设定时任务，约提前 200ms 发起收获请求，尽量压缩被偷窗口。和 60 秒施肥防偷可并存。" recommend="conditional" />
                <BaseSwitch v-model="localSettings.automation.fertilizer_smart_phase" label="智能二季施肥" hint="开启后，二季作物刚种植时不会马上浪费化肥，而是等到耗时最长的黄金阶段再自动进行延期施肥，实现单果经验/金钱收益最大化。" recommend="conditional" />
                <div class="border-t pt-2 dark:border-gray-700/50">
                  <BaseSelect
                    v-model="localSettings.automation.fertilizer"
                    label="内容选择：施肥策略"
                    class="!w-full"
                    :options="fertilizerOptions"
                    title="种植后自动施肥的方式。普通肥加速生长、有机肥改善土壤（可循环施直到耗尽）、两者兼用效果最佳。推荐：普通+有机"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 好友互动详细控制 (始终显示，关闭时灰化) -->
          <div class="relative border rounded-2xl p-5 transition-all" :class="localSettings.automation.friend ? 'border-blue-100/50 bg-blue-50/50 dark:border-blue-800/30 dark:bg-blue-900/10' : 'border-gray-200/30 bg-gray-100/20 dark:border-gray-700/30 dark:bg-gray-800/20'">
            <!-- 灰化遮罩：总开关关闭时覆盖内容区 -->
            <div v-if="!localSettings.automation.friend" class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/30 backdrop-blur-[1px]">
              <span class="border border-white/10 rounded-lg bg-black/50 px-4 py-2 text-sm text-gray-300 font-bold shadow-lg">
                🔒 请先开启上方「自动好友互动」总开关
              </span>
            </div>
            <h4 class="mb-4 flex items-center text-xs font-bold tracking-widest uppercase" :class="localSettings.automation.friend ? 'text-blue-500' : 'text-gray-400'">
              <div class="i-carbon-user-multiple mr-2" /> 社交互动详细策略
              <BaseTooltip text="只有在主开关【自动好友互动】开启时此策略组才会生效，控制在好友农场的具体行为。" />
            </h4>
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-4 md:grid-cols-2" :class="{ 'opacity-40 pointer-events-none select-none': !localSettings.automation.friend }">
              <!-- 蹲守开关：独立占一格 -->
              <BaseSwitch v-model="localSettings.stakeoutSteal.enabled" label="精准蹲守偷菜" hint="自动记录好友作物成熟时间，到点精准出击偷取高价值果实。" recommend="conditional" />
              <!-- 蹲守延迟设置：独立占一格，仅在开启后显示内容 -->
              <div class="inline-flex flex-col gap-1">
                <template v-if="localSettings.stakeoutSteal.enabled">
                  <label class="inline-flex items-center gap-2">
                    <span class="glass-text-main select-none text-sm font-medium">蹲守延迟</span>
                    <div class="flex items-center gap-1.5 border border-gray-300/50 rounded-md bg-black/5 px-2 py-1 dark:border-white/10 dark:bg-black/20">
                      <input
                        v-model.number="localSettings.stakeoutSteal.delaySec"
                        type="number"
                        min="0"
                        max="60"
                        class="glass-text-main w-12 bg-transparent text-center text-sm font-bold outline-none"
                      >
                      <span class="glass-text-muted text-xs font-bold">秒</span>
                    </div>
                  </label>
                  <p class="hint-text glass-text-muted ml-1 text-[10px] leading-tight opacity-70">
                    成熟后等待几秒再偷，模拟真人操作节奏，推荐 3~10 秒。
                    <span class="recommend-badge recommend-conditional">推荐 3 秒</span>
                  </p>
                </template>
                <template v-else>
                  <span class="glass-text-muted select-none text-sm">蹲守延迟设置</span>
                  <p class="hint-text glass-text-muted ml-1 text-[10px] leading-tight opacity-70">
                    请先开启左侧「精准蹲守偷菜」开关。
                  </p>
                </template>
              </div>

              <BaseSwitch v-model="localSettings.automation.friend_steal" label="自动偷菜" hint="访问好友农场时自动偷取成熟果实，是金币收入的重要补充来源。" recommend="on" />
              <BaseSwitch v-model="localSettings.automation.friend_help" label="自动帮忙" hint="访问好友农场时自动帮忙浇水/除草/除虫，可获得经验奖励。" recommend="on" />
              <BaseSwitch v-model="localSettings.automation.friend_bad" label="自动捣乱" hint="访问好友农场时自动放虫/放草。有社交风险，好友可能拉黑你，小号专用。" recommend="off" />
              <BaseSwitch v-model="localSettings.automation.friend_auto_accept" label="自动同意好友" hint="自动同意所有好友申请。好友越多偷菜机会越多，但也增加被偷风险。" recommend="conditional" />
              <BaseSwitch v-model="localSettings.automation.friend_help_exp_limit" label="经验上限停止帮忙" hint="当日帮忙经验达到系统上限后自动停止，避免做无用功浪费请求配额。" recommend="on" />
              <BaseSwitch v-model="localSettings.automation.forceGetAllEnabled" label="强效兼容尝试" hint="如果发现好友列表一直为空（多见于微信最新环境），请开启此项强制尝试 GetAll 拉取。" recommend="conditional" />
            </div>
          </div>

          <!-- 偷菜与好友过滤 (已迁移) -->
          <div class="border-2 border-primary-200 rounded-2xl border-dashed bg-primary-50/50 p-6 text-center dark:border-primary-800/30 dark:bg-primary-900/10">
            <div class="mx-auto mb-3 h-12 w-12 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-800/50">
              <div class="i-carbon-sprout text-2xl text-primary-600 dark:text-primary-400" />
            </div>
            <h4 class="glass-text-main text-sm font-bold">
              偷菜白名单与作物过滤已迁移
            </h4>
            <p class="glass-text-muted dark:glass-text-muted mx-auto mt-2 max-w-md text-xs">
              为了提供更加流畅与精细的控制体验，我们设计了全新的独立管理面板。包含可视化图标、等级检视以及便捷的模糊搜索。
            </p>
            <BaseButton
              to="/steal-settings"
              variant="success"
              class="mt-4"
            >
              前往偷菜控制台 <div class="i-carbon-arrow-right ml-2" />
            </BaseButton>
          </div>

        </div>

        <!-- Save Button -->
        <div class="mt-auto flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="saving"
            @click="saveAccountSettings"
          >
            保存策略与自动控制
          </BaseButton>
        </div>
      </div>

      <div v-else class="card glass-panel flex flex-col items-center justify-center gap-4 rounded-lg p-12 text-center shadow">
        <div class="rounded-full bg-gray-50/20 p-4 dark:bg-gray-700/20">
          <div class="i-carbon-settings-adjust glass-text-muted text-4xl" />
        </div>
        <div class="max-w-xs">
          <h3 class="glass-text-main text-lg font-medium">
            需要登录账号
          </h3>
          <p class="glass-text-muted mt-1 text-sm">
            请先登录账号以配置策略和自动化选项。
          </p>
        </div>
      </div>

      <!-- Card 2: System Settings (Password & Offline) -->
      <div class="card glass-panel h-full flex flex-col rounded-lg shadow">
        <!-- Password Header -->
        <div class="border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-password" />
            账号密码
            <span v-if="currentUsername" class="rounded bg-primary-100 px-2 py-0.5 text-xs text-primary-600 font-normal dark:bg-primary-900/30 dark:text-primary-400">
              {{ currentUsername }}
            </span>
          </h3>
        </div>

        <!-- Password Content -->
        <form class="p-4 space-y-3" @submit.prevent="handleChangePassword">
          <input
            :value="currentUsername || ''"
            type="text"
            name="username"
            autocomplete="username"
            class="hidden"
            readonly
            tabindex="-1"
            aria-hidden="true"
          >
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <BaseInput
              v-model="passwordForm.old"
              label="当前密码"
              type="password"
              autocomplete="current-password"
              placeholder="当前登录密码"
            />
            <BaseInput
              v-model="passwordForm.new"
              label="新密码"
              type="password"
              autocomplete="new-password"
              :placeholder="isAdmin ? '至少 4 位' : '至少 6 位，需含字母和数字'"
            />
            <BaseInput
              v-model="passwordForm.confirm"
              label="确认新密码"
              type="password"
              autocomplete="new-password"
              placeholder="再次输入新密码"
            />
          </div>

          <div class="flex items-center justify-between pt-1">
            <p class="glass-text-muted text-xs">
              修改当前登录账号 <strong>{{ currentUsername }}</strong> 的密码
            </p>
            <BaseButton
              variant="primary"
              size="sm"
              type="submit"
              :loading="passwordSaving"
            >
              修改密码
            </BaseButton>
          </div>
        </form>

        <template v-if="isAdmin">
          <!-- Offline Header -->
          <div class="border-b border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
            <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
              <div class="i-carbon-notification" />
              下线提醒
            </h3>
          </div>

          <!-- Offline Content -->
          <div class="flex-1 p-4 space-y-3">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="flex items-center gap-2">
                <BaseSelect
                  v-model="localOffline.channel"
                  label="推送渠道"
                  :options="channelOptions"
                  class="flex-1"
                />
                <a
                  v-if="channelDocUrl"
                  :href="channelDocUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-blue-100 px-2 py-1.5 text-xs text-blue-700 font-medium transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-300 dark:hover:bg-blue-800/40"
                  title="查看官方文档"
                >
                  <span class="i-carbon-launch text-xs" />
                  官网
                </a>
              </div>
              <BaseSelect
                v-model="localOffline.reloginUrlMode"
                label="重登录链接"
                :options="reloginUrlModeOptions"
              />
            </div>

            <BaseInput
              v-model="localOffline.endpoint"
              label="接口地址"
              type="text"
              :disabled="localOffline.channel !== 'webhook'"
            />

            <BaseInput
              v-model="localOffline.token"
              label="Token"
              type="text"
              placeholder="接收端 token"
            />

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <BaseInput
                v-model="localOffline.title"
                label="标题"
                type="text"
                placeholder="提醒标题"
              />
              <BaseInput
                v-model.number="localOffline.offlineDeleteSec"
                label="离线删除账号 (秒)"
                type="number"
                min="0"
                placeholder="0 表示不自动删除"
              />
            </div>

            <BaseInput
              v-model="localOffline.msg"
              label="内容"
              type="text"
              placeholder="提醒内容"
            />
          </div>

          <!-- Save Offline Button -->
          <div class="flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="offlineSaving"
              @click="handleSaveOffline"
            >
              保存下线提醒设置
            </BaseButton>
          </div>
        </template>

        <template v-if="currentAccountId">
          <div class="border-b border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
            <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
              <div class="i-carbon-report-data" />
              经营汇报
            </h3>
          </div>

          <div class="p-4">
            <div class="border border-emerald-100/60 rounded-2xl bg-emerald-50/40 p-5 dark:border-emerald-800/40 dark:bg-emerald-950/10">
              <div class="mb-4 flex items-center justify-between gap-3">
                <h4 class="flex items-center gap-2 text-xs text-emerald-700 font-bold tracking-widest uppercase dark:text-emerald-300">
                  <div class="i-carbon-report-data mr-1" /> 经营汇报
                </h4>
                <div class="flex flex-wrap gap-2">
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="reportSendingMode === 'hourly'"
                    @click="handleSendReport('hourly')"
                  >
                    立即发小时汇报
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="reportSendingMode === 'daily'"
                    @click="handleSendReport('daily')"
                  >
                    立即发日报
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="reportTesting"
                    @click="handleSendReportTest"
                  >
                    发送测试汇报
                  </BaseButton>
                </div>
              </div>

              <div class="space-y-4">
                <BaseSwitch
                  v-model="localSettings.reportConfig.enabled"
                  label="启用经营汇报"
                  hint="按设定周期向推送渠道发送账号经营摘要。默认复用你在这里填写的专属推送参数，不影响全局下线提醒。"
                  recommend="conditional"
                />

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="flex items-center gap-2">
                    <BaseSelect
                      v-model="localSettings.reportConfig.channel"
                      label="推送渠道"
                      :options="channelOptions"
                      class="flex-1"
                    />
                    <a
                      v-if="reportChannelDocUrl"
                      :href="reportChannelDocUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="mt-5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-100 px-2 py-1.5 text-xs text-emerald-700 font-medium transition dark:bg-emerald-900/30 hover:bg-emerald-200 dark:text-emerald-300 dark:hover:bg-emerald-800/40"
                      title="查看官方文档"
                    >
                      <span class="i-carbon-launch text-xs" />
                      官网
                    </a>
                  </div>
                  <BaseInput
                    v-model="localSettings.reportConfig.title"
                    label="汇报标题"
                    type="text"
                    placeholder="经营汇报"
                  />
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <BaseInput
                    v-model="localSettings.reportConfig.endpoint"
                    label="接口地址"
                    type="text"
                    :disabled="localSettings.reportConfig.channel !== 'webhook'"
                    placeholder="Webhook 渠道必填"
                  />
                  <BaseInput
                    v-model="localSettings.reportConfig.token"
                    label="Token"
                    type="text"
                    placeholder="非 Webhook 渠道通常必填"
                  />
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="rounded-xl border border-emerald-200/60 bg-white/50 p-4 dark:border-emerald-800/30 dark:bg-black/10">
                    <BaseSwitch
                      v-model="localSettings.reportConfig.hourlyEnabled"
                      label="小时汇报"
                      hint="到达指定分钟后，发送最近 1 小时的收益与动作摘要。"
                      recommend="conditional"
                    />
                    <div class="mt-3 flex items-center gap-3">
                      <span class="glass-text-muted text-[11px] font-bold tracking-widest uppercase">每小时第</span>
                      <BaseInput
                        v-model.number="localSettings.reportConfig.hourlyMinute"
                        type="number"
                        min="0"
                        max="59"
                        class="w-24 text-sm shadow-inner !py-1"
                        :disabled="!localSettings.reportConfig.hourlyEnabled"
                      />
                      <span class="text-xs text-gray-500 dark:text-gray-400">分钟发送</span>
                    </div>
                  </div>

                  <div class="rounded-xl border border-emerald-200/60 bg-white/50 p-4 dark:border-emerald-800/30 dark:bg-black/10">
                    <BaseSwitch
                      v-model="localSettings.reportConfig.dailyEnabled"
                      label="每日汇报"
                      hint="按设定时刻发送今日累计经营摘要，适合晚间复盘。"
                      recommend="on"
                    />
                    <div class="mt-3 flex items-center gap-3">
                      <span class="glass-text-muted text-[11px] font-bold tracking-widest uppercase">每天</span>
                      <BaseInput
                        v-model.number="localSettings.reportConfig.dailyHour"
                        type="number"
                        min="0"
                        max="23"
                        class="w-24 text-sm shadow-inner !py-1"
                        :disabled="!localSettings.reportConfig.dailyEnabled"
                      />
                      <span class="text-xs text-gray-500 dark:text-gray-400">时</span>
                      <BaseInput
                        v-model.number="localSettings.reportConfig.dailyMinute"
                        type="number"
                        min="0"
                        max="59"
                        class="w-24 text-sm shadow-inner !py-1"
                        :disabled="!localSettings.reportConfig.dailyEnabled"
                      />
                      <span class="text-xs text-gray-500 dark:text-gray-400">分发送</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-xl border border-emerald-200/60 bg-white/50 p-4 dark:border-emerald-800/30 dark:bg-black/10">
                  <div class="mb-2 flex items-center gap-2 text-xs text-emerald-700 font-bold tracking-widest uppercase dark:text-emerald-300">
                    <div class="i-carbon-data-base mr-1" /> 历史保留策略
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="glass-text-muted text-[11px] font-bold tracking-widest uppercase">自动保留</span>
                    <BaseInput
                      v-model.number="localSettings.reportConfig.retentionDays"
                      type="number"
                      min="0"
                      max="365"
                      class="w-24 text-sm shadow-inner !py-1"
                    />
                    <span class="text-xs text-gray-500 dark:text-gray-400">天</span>
                  </div>
                  <p class="mt-2 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
                    填 <span class="font-bold">0</span> 表示不自动清理；填 1~365 表示系统每天自动清理一次过期汇报，并在每次发送后顺手回收当前账号的旧记录。
                  </p>
                </div>

                <div class="border-t border-emerald-200/60 pt-4 dark:border-emerald-800/30">
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <h5 class="text-xs text-emerald-700 font-bold tracking-widest uppercase dark:text-emerald-300">
                      最近汇报记录
                    </h5>
                    <div class="flex flex-wrap gap-2">
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :disabled="selectedReportLogCount === 0"
                        :loading="reportHistoryBatchDeleting"
                        @click="handleDeleteReportLogs(selectedReportLogIds)"
                      >
                        删除选中
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :loading="reportHistoryExporting"
                        @click="handleExportReportLogs"
                      >
                        导出当前筛选
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :loading="reportHistoryLoading"
                        @click="() => refreshReportLogs()"
                      >
                        刷新记录
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :loading="reportHistoryClearing"
                        @click="handleClearReportLogs"
                      >
                        清空记录
                      </BaseButton>
                    </div>
                  </div>

                  <div class="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <BaseSelect
                      v-model="reportFilters.mode"
                      label="筛选类型"
                      :options="reportModeOptions"
                    />
                    <BaseSelect
                      v-model="reportFilters.status"
                      label="筛选结果"
                      :options="reportStatusOptions"
                    />
                    <BaseSelect
                      v-model="reportPageSize"
                      label="每页条数"
                      :options="reportPageSizeOptions"
                    />
                    <BaseInput
                      v-model="reportKeyword"
                      label="关键字搜索"
                      type="text"
                      placeholder="标题 / 正文 / 失败原因"
                      @keydown.enter="handleApplyReportSearch"
                    />
                  </div>

                  <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      <span v-if="reportKeyword.trim()">当前关键字：{{ reportKeyword.trim() }}</span>
                      <span v-else>未启用关键字搜索</span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        @click="handleApplyReportSearch"
                      >
                        搜索
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        @click="handleShowLatestFailed"
                      >
                        最新失败
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        @click="handleResetReportHistoryView"
                      >
                        恢复默认视图
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :disabled="!reportKeyword"
                        @click="reportKeyword = ''; handleApplyReportSearch()"
                      >
                        清空搜索
                      </BaseButton>
                    </div>
                  </div>

                  <div class="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <BaseSelect
                      v-model="reportSortOrder"
                      label="时间排序"
                      :options="reportSortOrderOptions"
                    />
                  </div>

                  <div class="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <button
                      v-for="item in reportHistoryStatsCards"
                      :key="item.key"
                      type="button"
                      class="rounded-xl border border-emerald-200/60 px-3 py-3 text-left transition-all duration-150 dark:border-emerald-800/30"
                      :class="[
                        item.bg,
                        item.active
                          ? 'ring-2 ring-emerald-500/70 shadow-md dark:ring-emerald-400/60'
                          : 'hover:-translate-y-0.5 hover:shadow-sm',
                      ]"
                      :title="`点击筛选${item.label}`"
                      @click="handleReportStatsCardClick(item.key)"
                    >
                      <div class="flex items-center justify-between gap-2 text-[11px] text-gray-500 font-bold tracking-widest uppercase dark:text-gray-400">
                        <span>{{ item.label }}</span>
                        <span v-if="item.active" class="text-emerald-600 dark:text-emerald-300">已筛选</span>
                      </div>
                      <div class="mt-2 text-2xl font-black" :class="item.tone">
                        {{ item.value }}
                      </div>
                      <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        点击快速筛选
                      </div>
                    </button>
                  </div>

                  <div class="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <div class="flex flex-wrap items-center gap-3">
                      <span>
                        共 {{ reportLogPagination.total }} 条记录，当前第 {{ reportLogPagination.page }} / {{ reportLogPagination.totalPages }} 页
                      </span>
                      <label class="inline-flex items-center gap-2 select-none">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          :checked="allVisibleReportLogsSelected"
                          @change="toggleSelectAllVisibleReportLogs"
                        >
                        <span>全选当前页</span>
                      </label>
                      <span v-if="selectedReportLogCount > 0" class="text-emerald-600 font-semibold dark:text-emerald-300">
                        已选 {{ selectedReportLogCount }} 条
                      </span>
                    </div>
                    <div class="flex gap-2">
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :disabled="reportHistoryLoading || reportLogPagination.page <= 1"
                        @click="goToReportLogPage(reportLogPagination.page - 1)"
                      >
                        上一页
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        :disabled="reportHistoryLoading || reportLogPagination.page >= reportLogPagination.totalPages"
                        @click="goToReportLogPage(reportLogPagination.page + 1)"
                      >
                        下一页
                      </BaseButton>
                    </div>
                  </div>

                  <div v-if="reportHistoryLoading" class="rounded-xl border border-dashed border-emerald-200/70 bg-white/40 px-4 py-5 text-center text-xs text-gray-500 dark:border-emerald-800/30 dark:bg-black/10 dark:text-gray-400">
                    正在加载汇报历史...
                  </div>

                  <div v-else-if="reportLogs.length === 0" class="rounded-xl border border-dashed border-emerald-200/70 bg-white/40 px-4 py-5 text-center text-xs text-gray-500 dark:border-emerald-800/30 dark:bg-black/10 dark:text-gray-400">
                    还没有经营汇报历史记录
                  </div>

                  <div v-else class="space-y-3">
                    <div
                      v-for="item in reportLogs"
                      :key="item.id"
                      class="rounded-xl border border-emerald-200/60 bg-white/50 p-4 dark:border-emerald-800/30 dark:bg-black/10"
                    >
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0 flex flex-1 items-start gap-3">
                          <label class="mt-0.5 inline-flex items-center">
                            <input
                              type="checkbox"
                              class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                              :checked="isReportLogSelected(item.id)"
                              @change="toggleReportLogSelected(item.id)"
                            >
                          </label>
                          <div class="min-w-0 flex-1">
                            <div class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
                              {{ item.title || '经营汇报' }}
                            </div>
                            <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                              {{ formatReportMode(item.mode) }} · {{ formatReportLogTime(item.createdAt) }} · {{ item.channel || 'unknown' }}
                            </div>
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                          <span
                            class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                            :class="item.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'"
                          >
                            {{ item.ok ? '成功' : '失败' }}
                          </span>
                          <BaseButton
                            variant="secondary"
                            size="sm"
                            :loading="reportHistoryDeletingIds.includes(item.id)"
                            @click="handleDeleteReportLogs([item.id], { single: true, title: `「${item.title || '经营汇报'}」` })"
                          >
                            删除
                          </BaseButton>
                        </div>
                      </div>

                      <div
                        class="mt-3 overflow-auto whitespace-pre-line rounded-lg bg-black/5 px-3 py-2 text-xs leading-5 text-gray-700 dark:bg-white/5 dark:text-gray-300"
                        :class="isReportLogExpanded(item.id) ? 'max-h-64' : 'max-h-24'"
                      >
                        {{ isReportLogExpanded(item.id) ? (item.content || '无正文') : getReportLogPreview(item.content) }}
                      </div>

                      <div
                        v-if="item.errorMessage"
                        class="mt-2 text-xs text-red-600 dark:text-red-400"
                      >
                        失败原因：{{ item.errorMessage }}
                      </div>

                      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span class="text-[11px] text-gray-500 dark:text-gray-400">
                          {{ isReportLogExpanded(item.id) ? '已展开完整正文' : '当前显示正文预览' }}
                        </span>
                        <div class="flex flex-wrap gap-2">
                          <BaseButton
                            variant="secondary"
                            size="sm"
                            @click="toggleReportLogExpanded(item.id)"
                          >
                            {{ isReportLogExpanded(item.id) ? '收起正文' : '展开正文' }}
                          </BaseButton>
                          <BaseButton
                            variant="secondary"
                            size="sm"
                            @click="openReportLogDetail(item)"
                          >
                            查看详情
                          </BaseButton>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Card Time Parameters: 系统级时间参数调优（仅管理员可见） -->
      <div v-if="isAdmin" class="card glass-panel h-full flex flex-col rounded-lg shadow lg:col-span-2">
        <div class="flex items-center justify-between border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-time" />
            ⏱ 时间参数调优 (System Timing)
          </h3>
          <BaseButton
            variant="secondary"
            size="sm"
            @click="restoreTimingDefaults"
          >
            <div class="i-carbon-reset mr-1" /> 恢复默认推荐值
          </BaseButton>
        </div>

        <div class="p-4 space-y-6">
          <div class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <!-- Group 1: Network & Heartbeat -->
            <div class="space-y-4">
              <h4 class="glass-text-muted flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-network-4 mr-2" /> 网络与心跳
              </h4>
              <BaseInput
                v-model.number="localTiming.heartbeatIntervalMs"
                label="WebSocket 心跳间隔 (ms)"
                type="number"
                min="5000"
                step="1000"
                hint="维持长连接的频率，推荐 25000ms"
              />
              <BaseInput
                v-model.number="localTiming.rateLimitIntervalMs"
                label="API 发送限流间隔 (ms)"
                type="number"
                min="100"
                step="1"
                hint="请求指纹匀速器。3QPS = 334ms"
              />
            </div>

            <!-- Group 2: Ghosting (Anti-Detection) -->
            <div class="space-y-4">
              <h4 class="glass-text-muted flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-asleep mr-2" /> Ghosting 打盹行为
              </h4>
              <div class="grid grid-cols-2 gap-3">
                <BaseInput
                  v-model.number="localTiming.ghostingProbability"
                  label="打盹触发概率"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                />
                <BaseInput
                  v-model.number="localTiming.ghostingCooldownMin"
                  label="冷却期 (分钟)"
                  type="number"
                  min="1"
                />
                <BaseInput
                  v-model.number="localTiming.ghostingMinMin"
                  label="最短休眠 (分)"
                  type="number"
                  min="1"
                />
                <BaseInput
                  v-model.number="localTiming.ghostingMaxMin"
                  label="最长休眠 (分)"
                  type="number"
                  min="1"
                />
              </div>
              <p class="text-[10px] text-orange-500 italic">
                模拟真人疲劳休眠，随机下线避开长时间挂机检测。
              </p>
            </div>

            <!-- Group 3: Operation Intervals -->
            <div class="space-y-4">
              <h4 class="glass-text-muted flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-keyboard mr-2" /> 邀请与微延迟 (只读预览)
              </h4>
              <BaseInput
                v-model.number="localTiming.inviteRequestDelay"
                label="邀请请求延迟 (ms)"
                type="number"
                min="500"
                step="100"
              />
              <div class="border border-white/10 rounded-lg bg-black/5 p-2 dark:bg-black/20">
                <div v-for="p in settingStore.settings.readonlyTimingParams" :key="p.key" class="flex justify-between py-1 text-[11px]">
                  <span class="glass-text-muted">{{ p.label }}</span>
                  <span class="text-primary-500 font-mono">{{ p.value }}</span>
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <h4 class="glass-text-muted flex items-center text-xs font-bold tracking-widest uppercase">
                <div class="i-carbon-flow-stream mr-2" /> 调度器引擎
              </h4>
              <BaseSelect
                v-model="localTiming.schedulerEngine"
                label="默认调度引擎"
                :options="[
                  { label: '默认 setTimeout', value: 'default' },
                  { label: '全量时间轮', value: 'optimized' },
                  { label: '混合模式', value: 'hybrid' },
                ]"
              />
              <BaseInput
                v-model="localTiming.optimizedSchedulerNamespaces"
                label="时间轮命名空间"
                type="text"
                hint="逗号分隔，例如：system-jobs,account-report-service,worker_manager"
              />
              <div class="grid grid-cols-2 gap-3">
                <BaseInput
                  v-model.number="localTiming.optimizedSchedulerTickMs"
                  label="时间轮 Tick (ms)"
                  type="number"
                  min="10"
                />
                <BaseInput
                  v-model.number="localTiming.optimizedSchedulerWheelSize"
                  label="槽位数量"
                  type="number"
                  min="10"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-auto flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="timingSaving"
            @click="handleSaveTiming"
          >
            保存时间参数设置
          </BaseButton>
        </div>
      </div>

      <!-- Card New: 分布式与集群流控（仅管理员可见） -->
      <div v-if="isAdmin" class="card glass-panel h-full flex flex-col rounded-lg shadow lg:col-span-2">
        <div class="border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-flow-stream" />
            分布式与集群流控 (Cluster Routing)
          </h3>
        </div>

        <div class="p-4 space-y-4">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BaseSelect
              v-model="clusterConfig.dispatcherStrategy"
              label="集群派发器路由策略"
              :options="clusterStrategyOptions"
            />
          </div>
          <div class="alert alert-info mt-2 flex items-start gap-2 rounded-md bg-blue-50/50 p-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            <div class="i-carbon-information mt-0.5 shrink-0 text-base" />
            <div>
              <p class="font-bold">
                策略说明：
              </p>
              <ul class="ml-4 mt-1 list-disc opacity-90 space-y-1">
                <li><strong>轮询洗牌：</strong> 早期默认逻辑。新增账号或节点变动时，把所有存活账号抽出来均分给所有存活 Worker。(易引发大面积账号离线闪断)</li>
                <li><strong>最小负荷与粘性推流：</strong> 企业级商用逻辑。账号被精准分发到当前活跃数最少的离散节点上。并保持<strong>粘性心跳</strong>。只有老节点死亡或是新用户扫码登入时，才会触发推流动作，完全不影响已经在工作的进程丛集！</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="mt-auto flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="clusterSaving"
            @click="saveClusterConfig"
          >
            保存集群路由策略
          </BaseButton>
        </div>
      </div>

      <!-- Card 3: 体验卡配置（仅管理员可见） -->
      <div v-if="isAdmin" class="card glass-panel h-full flex flex-col rounded-lg shadow lg:col-span-2 relative z-10">
        <div class="border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-chemistry" />
            体验卡配置
          </h3>
        </div>

        <div class="p-4 space-y-4">
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BaseSwitch v-model="trialConfig.enabled" label="功能开关" />
            <BaseSwitch v-model="trialConfig.adminRenewEnabled" label="管理员一键续费" />
            <BaseSwitch v-model="trialConfig.userRenewEnabled" label="用户自助续费" />
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BaseSelect
              v-model="trialConfig.days"
              label="体验卡时长"
              :options="trialDaysOptions"
            />
            <BaseInput
              v-model.number="trialConfig.maxAccounts"
              label="绑定账号数"
              type="number"
              min="1"
              max="10"
            />
            <BaseInput
              v-model.number="trialConfig.dailyLimit"
              label="每日上限"
              type="number"
              min="1"
            />
            <BaseSelect
              v-model="trialConfig.cooldownMs"
              label="IP 冷却时间"
              :options="trialCooldownOptions"
            />
          </div>
        </div>

        <div class="mt-auto flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="trialSaving"
            @click="saveTrialConfig"
          >
            保存体验卡设置
          </BaseButton>
        </div>
      </div>

      <!-- Card 4: 第三方 API 配置（仅管理员可见） -->
      <div v-if="isAdmin" class="card glass-panel h-full flex flex-col rounded-lg shadow lg:col-span-2">
        <div class="border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-api-1" />
            第三方 API 配置
          </h3>
        </div>

        <div class="p-4 space-y-4">
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-3 md:grid-cols-2">
            <BaseInput
              v-model="thirdPartyApiConfig.wxApiKey"
              label="微信登录 API Key (wxApiKey)"
              type="password"
              autocomplete="off"
              placeholder="请输入与第三方授权约定的 ApiKey"
            />
            <BaseInput
              v-model="thirdPartyApiConfig.wxAppId"
              label="QQ农场 AppId (wxAppId)"
              type="text"
              placeholder="默认从接口获取，可覆盖定制"
            />
            <BaseInput
              v-model="thirdPartyApiConfig.wxApiUrl"
              label="微信登录请求网关 (wxApiUrl)"
              type="text"
              placeholder="一般为内部或三方中转代理服务地址"
            />
            <BaseInput
              v-model="thirdPartyApiConfig.ipad860Url"
              label="Ipad860 服务地址"
              type="text"
              placeholder="如 http://127.0.0.1:8058 或 http://ipad860:8058"
            />
            <BaseInput
              v-model="thirdPartyApiConfig.aineisheKey"
              label="码雨云 API Token (QQ扫码)"
              type="password"
              autocomplete="off"
              placeholder="请输入 aineishe.com 获取的 Token"
            />
          </div>
          <div class="alert alert-warning mt-2 flex items-start gap-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            <div class="i-carbon-warning-alt mt-0.5 mt-0.5 shrink-0 text-base" />
            <p>更改此项配置会立即刷新扫码中转服务器参数。如果改错导致扫码无反应，请重新设置正确的值，原环境变量已不再具有覆写能力。</p>
          </div>
        </div>

        <div class="mt-auto flex justify-end border-t border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="thirdPartyApiSaving"
            @click="saveThirdPartyApiConfig"
          >
            保存第三方 API 设置
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Card 4: 系统主题与背景（仅管理员可见） -->
    <div v-if="isAdmin" class="card glass-panel h-full flex flex-col rounded-lg shadow lg:col-span-2">
      <div class="border-b border-gray-200/50 bg-transparent px-4 py-3 dark:border-gray-700/50">
        <h3 class="glass-text-main flex items-center gap-2 text-base font-bold">
          <div class="i-carbon-paint-brush" />
          系统外观与自定义背景
        </h3>
      </div>

      <div class="p-4 space-y-5">
        <div class="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div class="space-y-4">
            <BaseInput
              v-model="appStore.loginBackground"
              label="登录页背景图片 URL"
              placeholder="请输入图片链接 (如: https://example.com/bg.jpg)"
            />

            <div class="rounded-2xl border border-primary-500/20 bg-primary-500/8 p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="glass-text-main text-sm font-bold">
                    当前主题联动
                  </div>
                  <p class="glass-text-muted mt-1 text-xs leading-5">
                    当前主题为「{{ currentThemeOption.name }}」，可一键套用对应的专属背景预设。
                  </p>
                </div>
                <BaseButton
                  variant="primary"
                  size="sm"
                  @click="applyCurrentThemeBackgroundPreset"
                >
                  套用 {{ currentThemeBackgroundPreset.title }}
                </BaseButton>
              </div>
            </div>

            <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
              <div class="glass-text-main text-sm font-medium">
                背景作用范围
              </div>
              <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <button
                  v-for="option in UI_BACKGROUND_SCOPE_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="rounded-2xl border px-3 py-3 text-left transition-all"
                  :class="appStore.backgroundScope === option.value
                    ? 'border-primary-500 bg-primary-500/10 shadow-lg shadow-primary-500/10'
                    : 'border-white/10 bg-white/5 hover:border-primary-500/30 hover:bg-white/10 dark:bg-black/10'"
                  @click="appStore.backgroundScope = option.value"
                >
                  <div class="glass-text-main text-sm font-semibold">
                    {{ option.label }}
                  </div>
                  <p class="glass-text-muted mt-1 text-[11px] leading-5">
                    {{ option.description }}
                  </p>
                </button>
              </div>
            </div>

            <input
              ref="backgroundFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="handleBackgroundFileChange"
            >

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
                <div class="flex items-center justify-between gap-3">
                  <span class="glass-text-main text-sm font-medium">登录页遮罩强度</span>
                  <span class="rounded-full bg-primary-500/15 px-2.5 py-1 text-[11px] font-bold text-primary-500">
                    {{ appStore.loginBackgroundOverlayOpacity }}%
                  </span>
                </div>
                <input
                  v-model.number="appStore.loginBackgroundOverlayOpacity"
                  type="range"
                  min="0"
                  max="80"
                  step="1"
                  class="mt-4 w-full cursor-pointer accent-primary-500"
                >
                <p class="glass-text-muted mt-2 text-[11px] leading-5">
                  数值越高，图片越暗，登录卡片和标题文字更容易稳住。
                </p>
              </div>

              <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
                <div class="flex items-center justify-between gap-3">
                  <span class="glass-text-main text-sm font-medium">登录页模糊度</span>
                  <span class="rounded-full bg-primary-500/15 px-2.5 py-1 text-[11px] font-bold text-primary-500">
                    {{ appStore.loginBackgroundBlur }}px
                  </span>
                </div>
                <input
                  v-model.number="appStore.loginBackgroundBlur"
                  type="range"
                  min="0"
                  max="12"
                  step="1"
                  class="mt-4 w-full cursor-pointer accent-primary-500"
                >
                <p class="glass-text-muted mt-2 text-[11px] leading-5">
                  轻微模糊可以削弱杂乱背景，避免图片主体抢走登录焦点。
                </p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
                <div class="flex items-center justify-between gap-3">
                  <span class="glass-text-main text-sm font-medium">主界面遮罩强度</span>
                  <span class="rounded-full bg-primary-500/15 px-2.5 py-1 text-[11px] font-bold text-primary-500">
                    {{ appStore.appBackgroundOverlayOpacity }}%
                  </span>
                </div>
                <input
                  v-model.number="appStore.appBackgroundOverlayOpacity"
                  type="range"
                  min="20"
                  max="90"
                  step="1"
                  class="mt-4 w-full cursor-pointer accent-primary-500"
                >
                <p class="glass-text-muted mt-2 text-[11px] leading-5">
                  业务页推荐更重一点，让日志、表格、卡片始终保持高可读性。
                </p>
              </div>

              <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
                <div class="flex items-center justify-between gap-3">
                  <span class="glass-text-main text-sm font-medium">主界面模糊度</span>
                  <span class="rounded-full bg-primary-500/15 px-2.5 py-1 text-[11px] font-bold text-primary-500">
                    {{ appStore.appBackgroundBlur }}px
                  </span>
                </div>
                <input
                  v-model.number="appStore.appBackgroundBlur"
                  type="range"
                  min="0"
                  max="18"
                  step="1"
                  class="mt-4 w-full cursor-pointer accent-primary-500"
                >
                <p class="glass-text-muted mt-2 text-[11px] leading-5">
                  主界面模糊通常比登录页更高，这样背景存在感还在，但不会干扰操作。
                </p>
              </div>
            </div>

            <div class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5">
              <div class="flex flex-wrap items-center gap-3">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="backgroundUploading"
                  @click="triggerBackgroundUpload"
                >
                  本地上传背景图
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="backgroundSaving"
                  @click="saveLoginAppearance"
                >
                  保存主题与背景
                </BaseButton>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :disabled="backgroundSaving || backgroundUploading"
                  @click="restoreDefaultLoginAppearance"
                >
                  恢复默认
                </BaseButton>
              </div>
              <p class="glass-text-muted mt-3 text-xs leading-5">
                支持 JPG / PNG / WebP。本地上传会先在浏览器压缩，再保存到服务端静态目录，避免把图片直接塞进配置里。
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <span class="glass-text-muted text-xs font-medium">预览 (效果参考)</span>
              <button
                type="button"
                class="glass-text-main rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] transition-all hover:bg-white/25 dark:border-white/10 dark:bg-black/20 dark:hover:bg-black/35"
                @click="openLoginPreview"
              >
                打开全屏预览
              </button>
            </div>

            <button
              type="button"
              class="group relative h-40 w-full overflow-hidden border border-white/20 rounded-2xl text-left shadow-sm transition-all duration-300 dark:border-white/10 hover:shadow-lg hover:shadow-black/10"
              :style="loginPreviewBackgroundStyle"
              @click="openLoginPreview"
            >
              <div v-if="loginPreviewUsesCustomBackground" class="absolute inset-0" :style="loginPreviewMaskStyle" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/10 opacity-80" />
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="glass-text-main border border-white/25 rounded-xl bg-white/55 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition-transform duration-300 dark:bg-black/40 dark:text-white group-hover:scale-105">
                  玻璃拟态预览
                </div>
              </div>
              <div class="absolute bottom-3 left-3 border border-white/20 rounded-full bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                遮罩 {{ appStore.loginBackgroundOverlayOpacity }}%
              </div>
              <div class="absolute bottom-3 right-3 border border-white/20 rounded-full bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                模糊 {{ appStore.loginBackgroundBlur }}px
              </div>
            </button>

            <div
              class="relative h-36 overflow-hidden border border-white/20 rounded-2xl dark:border-white/10"
              :style="loginPreviewBackgroundStyle"
            >
              <div v-if="loginPreviewUsesCustomBackground" class="absolute inset-0" :style="appScenePreviewMaskStyle" />
              <div class="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/20" />
              <div class="absolute left-3 top-3 rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                主界面氛围预览
              </div>
              <div class="absolute inset-0 flex gap-3 p-4">
                <div class="w-20 border border-white/15 rounded-2xl bg-white/12 p-3 backdrop-blur-xl">
                  <div class="mb-3 h-6 w-6 rounded-lg bg-white/70" />
                  <div class="space-y-2">
                    <div class="h-2 rounded bg-white/40" />
                    <div class="h-2 rounded bg-white/20" />
                    <div class="h-2 rounded bg-white/20" />
                  </div>
                </div>
                <div class="flex flex-1 flex-col gap-3">
                  <div class="border border-white/15 rounded-2xl bg-white/14 p-3 backdrop-blur-xl">
                    <div class="h-3 w-36 rounded bg-white/55" />
                  </div>
                  <div class="grid flex-1 grid-cols-2 gap-3">
                    <div class="border border-white/15 rounded-2xl bg-white/12 p-3 backdrop-blur-xl" />
                    <div class="border border-white/15 rounded-2xl bg-white/12 p-3 backdrop-blur-xl" />
                  </div>
                </div>
              </div>
              <div class="absolute bottom-3 right-3 border border-white/20 rounded-full bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                {{ appStore.backgroundScope === 'login_only' ? '当前未对主界面启用' : `遮罩 ${appStore.appBackgroundOverlayOpacity}% / 模糊 ${appStore.appBackgroundBlur}px` }}
              </div>
            </div>

            <p v-if="loginPreviewLoading" class="text-xs text-amber-500">
              正在验证图片链接，加载完成后会自动应用到预览。
            </p>
            <p v-else-if="loginPreviewLoadFailed" class="text-xs text-rose-400">
              当前图片链接加载失败，预览已回退到默认渐变。建议使用可直接访问的 JPG / PNG / WebP 地址。
            </p>
            <p v-else class="glass-text-muted text-xs">
              缩略图和全屏弹窗都会按登录页的玻璃拟态结构渲染，便于判断背景是否压字。
            </p>
          </div>
        </div>

        <div class="border-t border-white/10 pt-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="glass-text-main text-sm font-bold">
                背景预设图库
              </div>
              <p class="glass-text-muted mt-1 text-xs">
                点击预设会先套用到当前表单，确认效果后再点“应用背景设置”。
              </p>
            </div>
            <div class="glass-text-muted text-[11px]">
              当前参数：遮罩 {{ appStore.loginBackgroundOverlayOpacity }}% / 模糊 {{ appStore.loginBackgroundBlur }}px
            </div>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <button
              v-for="preset in orderedLoginBackgroundPresets"
              :key="preset.key"
              type="button"
              class="group overflow-hidden border rounded-2xl bg-black/5 text-left transition-all duration-300 dark:bg-white/5 hover:-translate-y-1 hover:shadow-xl"
              :class="isSelectedLoginBackgroundPreset(preset)
                ? 'border-primary-500 shadow-lg shadow-primary-500/15'
                : 'border-white/10 dark:border-white/10'"
              @click="applyBackgroundPreset(preset)"
            >
              <div
                class="relative h-32 overflow-hidden"
                :style="preset.url
                  ? { backgroundImage: `url(${preset.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)' }"
              >
                <div
                  v-if="preset.url"
                  class="absolute inset-0"
                  :style="{
                    backgroundColor: `rgba(0, 0, 0, ${preset.overlayOpacity / 100})`,
                    backdropFilter: `blur(${preset.blur}px)`,
                    WebkitBackdropFilter: `blur(${preset.blur}px)`,
                  }"
                />
                <div class="absolute left-3 top-3 rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                  {{ preset.themeKey === appStore.colorTheme ? '当前主题推荐' : (preset.badge || '预设') }}
                </div>
                <div class="absolute bottom-3 right-3 rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[10px] text-white/90 backdrop-blur-md">
                  {{ preset.overlayOpacity }}% / {{ preset.blur }}px
                </div>
              </div>

              <div class="space-y-2 p-3">
                <div class="flex items-center justify-between gap-3">
                  <span class="glass-text-main text-sm font-semibold">{{ preset.title }}</span>
                  <span
                    v-if="isSelectedLoginBackgroundPreset(preset)"
                    class="rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] font-bold text-primary-500"
                  >
                    当前
                  </span>
                </div>
                <div v-if="preset.themeKey" class="glass-text-muted text-[11px]">
                  对应主题：{{ getThemeOption(preset.themeKey).name }}
                </div>
                <p class="glass-text-muted text-xs leading-5">
                  {{ preset.description }}
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  <Teleport to="body">
    <div v-if="loginPreviewVisible" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/65 backdrop-blur-md"
        @click="loginPreviewVisible = false"
      />

      <div class="relative z-10 max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/20 shadow-2xl dark:border-white/10">
        <div
          class="relative min-h-[78vh] overflow-hidden"
          :style="loginPreviewBackgroundStyle"
        >
          <div v-if="loginPreviewUsesCustomBackground" class="absolute inset-0" :style="loginPreviewMaskStyle" />
          <div v-else class="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/5" />

          <div class="absolute left-5 top-5 z-20 rounded-full border border-white/20 bg-black/25 px-4 py-1.5 text-xs text-white/90 backdrop-blur-md">
            登录页玻璃拟态预览
          </div>
          <div class="absolute left-5 top-16 z-20 rounded-full border border-white/20 bg-black/25 px-4 py-1.5 text-xs text-white/90 backdrop-blur-md">
            遮罩 {{ appStore.loginBackgroundOverlayOpacity }}% · 模糊 {{ appStore.loginBackgroundBlur }}px
          </div>

          <button
            type="button"
            class="absolute right-5 top-5 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-white/20 bg-black/25 text-white/90 backdrop-blur-md transition-colors hover:bg-black/40"
            @click="loginPreviewVisible = false"
          >
            <div class="i-carbon-close text-lg" />
          </button>

          <div class="relative z-10 min-h-[78vh] flex items-center justify-center px-5 py-12 lg:px-10">
            <div class="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div class="hidden border border-white/20 rounded-[28px] bg-white/10 p-8 text-white shadow-2xl backdrop-blur-xl lg:flex lg:flex-col lg:justify-between">
                <div>
                  <div class="mb-6 h-16 w-16 flex items-center justify-center rounded-3xl bg-white text-emerald-500 shadow-xl">
                    <div class="i-carbon-sprout text-3xl" />
                  </div>
                  <h3 class="text-3xl font-black tracking-tight">
                    御农·QQ 农场智能助手
                  </h3>
                  <p class="mt-3 max-w-md text-sm leading-6 text-white/80">
                    这里模拟的是登录页左侧品牌区和右侧表单卡片的叠层效果，主要用来判断背景图是否会干扰按钮、标题和输入区可读性。
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <div class="i-carbon-flash mb-2 text-xl" />
                    <div class="text-sm font-semibold">
                      极速自动化
                    </div>
                  </div>
                  <div class="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <div class="i-carbon-security mb-2 text-xl" />
                    <div class="text-sm font-semibold">
                      安全隔离
                    </div>
                  </div>
                </div>
              </div>

              <div class="border border-white/25 rounded-[28px] bg-white/18 p-5 shadow-2xl backdrop-blur-2xl dark:bg-black/25 lg:p-8">
                <div class="mx-auto max-w-md">
                  <div class="mb-6 flex items-center gap-3 text-white">
                    <div class="h-11 w-11 flex items-center justify-center rounded-2xl bg-white/80 text-emerald-500 shadow-lg">
                      <div class="i-carbon-sprout text-xl" />
                    </div>
                    <div>
                      <div class="text-lg font-bold">
                        欢迎回来
                      </div>
                      <div class="text-xs text-white/80">
                        预览背景图在真实登录页中的玻璃卡片表现
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <div class="rounded-2xl border border-white/20 bg-white/35 px-4 py-3 text-sm text-white/85 backdrop-blur-md dark:bg-black/25">
                      用户名 / 账号
                    </div>
                    <div class="rounded-2xl border border-white/20 bg-white/35 px-4 py-3 text-sm text-white/85 backdrop-blur-md dark:bg-black/25">
                      密码
                    </div>
                    <div class="rounded-2xl bg-white/85 px-4 py-3 text-center text-sm font-bold text-slate-800 shadow-lg">
                      登录按钮预览
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-center text-xs text-white/85">
                      <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                        自动化
                      </div>
                      <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                        多账号
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="loginPreviewLoadFailed"
            class="absolute bottom-5 left-5 right-5 z-20 rounded-2xl border border-rose-200/40 bg-rose-500/20 px-4 py-3 text-sm text-white backdrop-blur-xl"
          >
            当前图片链接无法直接加载，预览已自动回退为默认渐变背景。正式保存前建议先换成可直链图片。
          </div>
        </div>
      </div>
    </div>

    <div v-if="reportDetailVisible && reportDetailItem" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-gray-900/45 backdrop-blur-sm dark:bg-black/70"
        @click="closeReportLogDetail"
      />
      <div class="glass-panel relative z-10 max-h-[85vh] max-w-3xl w-full overflow-hidden border border-white/20 rounded-2xl shadow-2xl dark:border-white/10">
        <div class="flex items-center justify-between border-b border-gray-200/50 px-6 py-4 dark:border-white/10">
          <div class="min-w-0">
            <h3 class="truncate text-base text-gray-900 font-bold dark:text-gray-100">
              {{ reportDetailItem.title || '经营汇报详情' }}
            </h3>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ formatReportMode(reportDetailItem.mode) }} · {{ formatReportLogTime(reportDetailItem.createdAt) }} · {{ reportDetailItem.channel || 'unknown' }}
            </div>
          </div>
          <button
            class="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            @click="closeReportLogDetail"
          >
            <div class="i-carbon-close text-xl" />
          </button>
        </div>

        <div class="max-h-[calc(85vh-8rem)] overflow-auto px-6 py-5 space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full px-2.5 py-1 text-[11px] font-bold"
              :class="reportDetailItem.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'"
            >
              {{ reportDetailItem.ok ? '发送成功' : '发送失败' }}
            </span>
            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
              账号：{{ reportDetailItem.accountName || reportDetailItem.accountId || '-' }}
            </span>
            <span class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
              ID：{{ reportDetailItem.accountId || '-' }}
            </span>
          </div>

          <div v-if="reportDetailItem.errorMessage" class="rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            失败原因：{{ reportDetailItem.errorMessage }}
          </div>

          <div class="rounded-xl border border-emerald-200/60 bg-black/5 px-4 py-4 dark:border-emerald-800/30 dark:bg-white/5">
            <div class="mb-2 text-xs text-gray-500 font-bold tracking-widest uppercase dark:text-gray-400">
              完整正文
            </div>
            <div class="whitespace-pre-line break-words text-sm leading-6 text-gray-800 dark:text-gray-200">
              {{ reportDetailItem.content || '无正文' }}
            </div>
          </div>
        </div>

        <div class="flex justify-end border-t border-gray-200/50 px-6 py-4 dark:border-white/10">
          <BaseButton
            variant="secondary"
            size="sm"
            @click="closeReportLogDetail"
          >
            关闭
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>

  <ConfirmModal
    :show="modalVisible"
    :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />

    <!-- 改动预览 Modal -->
    <ConfirmModal
      :show="diffModalVisible"
      title="确认保存改动"
      confirm-text="确认并保存"
      cancel-text="再检查下"
      type="primary"
      @confirm="saveAccountSettings(true)"
      @cancel="diffModalVisible = false"
    >
      <div class="space-y-4">
        <p class="glass-text-muted text-sm">
          检测到以下配置项已变动：
        </p>
        <div class="max-h-60 overflow-y-auto border border-gray-100 rounded-xl bg-gray-50/50 p-2 dark:border-gray-700 dark:bg-gray-900/40">
          <div v-for="item in diffItems" :key="item.label" class="flex items-center justify-between border-b border-gray-100 p-2 last:border-0 dark:border-gray-700/50">
            <span class="glass-text-muted text-xs font-medium">{{ item.label }}</span>
            <div class="flex items-center gap-2 text-xs">
              <span class="glass-text-muted line-through">{{ item.from }}</span>
              <div class="i-carbon-arrow-right text-primary-500" />
              <span class="text-primary-600 font-bold dark:text-primary-400">{{ item.to }}</span>
            </div>
          </div>
        </div>
        <p class="text-[10px] text-orange-500 italic">
          提示：点击「确认并保存」后，后端调度器将立即应用新策略。
        </p>
      </div>
    </ConfirmModal>
  </div>
</template>

<style scoped lang="postcss">
/* Custom styles if needed */
</style>

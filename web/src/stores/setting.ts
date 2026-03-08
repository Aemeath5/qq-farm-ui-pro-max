import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface AutomationConfig {
  farm?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  landUpgradeTarget?: number
  friend?: boolean
  task?: boolean
  sell?: boolean
  fertilizer?: string
  fertilizer_buy?: boolean
  fertilizer_buy_limit?: number
  fertilizer_60s_anti_steal?: boolean
  fertilizer_smart_phase?: boolean
  fastHarvest?: boolean
  friend_steal?: boolean
  friend_help?: boolean
  friend_bad?: boolean
  friend_auto_accept?: boolean
  open_server_gift?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
  helpMin?: number
  helpMax?: number
  stealMin?: number
  stealMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface TradeSellRareKeepConfig {
  enabled?: boolean
  judgeBy?: 'plant_level' | 'unit_price' | 'either'
  minPlantLevel?: number
  minUnitPrice?: number
}

export interface TradeSellConfig {
  scope?: 'fruit_only'
  keepMinEachFruit?: number
  keepFruitIds?: number[]
  rareKeep?: TradeSellRareKeepConfig
  batchSize?: number
  previewBeforeManualSell?: boolean
}

export interface TradeConfig {
  sell?: TradeSellConfig
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  endpoint: string
  token: string
  title: string
  msg: string
  offlineDeleteSec: number
}

export interface ReportConfig {
  enabled: boolean
  channel: string
  endpoint: string
  token: string
  title: string
  hourlyEnabled: boolean
  hourlyMinute: number
  dailyEnabled: boolean
  dailyHour: number
  dailyMinute: number
  retentionDays: number
}

export interface ReportLogEntry {
  id: number
  accountId: string
  accountName: string
  mode: 'test' | 'hourly' | 'daily' | string
  ok: boolean
  channel: string
  title: string
  content: string
  errorMessage: string
  createdAt: string
}

export interface ReportLogPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface TrialCardConfig {
  enabled?: boolean
  days?: number
  adminRenewEnabled?: boolean
  userRenewEnabled?: boolean
  maxAccounts?: number
  dailyLimit?: number
  cooldownMs?: number
}

export interface ThirdPartyApiConfig {
  wxApiKey?: string
  wxApiUrl?: string
  wxAppId?: string
}

export interface UIConfig {
  theme?: string
}

export interface WorkflowNodeConfig {
  id: string
  type: string
  params?: Record<string, any>
}

export interface WorkflowLaneConfig {
  enabled: boolean
  minInterval: number
  maxInterval: number
  nodes: WorkflowNodeConfig[]
}

export interface WorkflowConfig {
  farm: WorkflowLaneConfig
  friend: WorkflowLaneConfig
}

export interface TimingConfig {
  heartbeatIntervalMs: number
  rateLimitIntervalMs: number
  ghostingProbability: number
  ghostingCooldownMin: number
  ghostingMinMin: number
  ghostingMaxMin: number
  inviteRequestDelay: number
  schedulerEngine: string
  optimizedSchedulerNamespaces: string
  optimizedSchedulerTickMs: number
  optimizedSchedulerWheelSize: number
}

export interface TimingParameter {
  key: string
  label: string
  value: any
  group: string
}

export interface ClusterConfig {
  dispatcherStrategy: string
}

export interface SettingsState {
  plantingStrategy: string
  preferredSeedId: number
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  tradeConfig: TradeConfig
  automation: AutomationConfig
  reportConfig: ReportConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  trialConfig: TrialCardConfig
  thirdPartyApi: ThirdPartyApiConfig
  workflowConfig: WorkflowConfig
  timingConfig: TimingConfig
  defaultTimingConfig: TimingConfig
  readonlyTimingParams: TimingParameter[]
  clusterConfig: ClusterConfig
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    tradeConfig: {
      sell: {
        scope: 'fruit_only',
        keepMinEachFruit: 0,
        keepFruitIds: [],
        rareKeep: {
          enabled: false,
          judgeBy: 'either',
          minPlantLevel: 40,
          minUnitPrice: 2000,
        },
        batchSize: 15,
        previewBeforeManualSell: false,
      },
    },
    automation: {},
    reportConfig: {
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
    },
    ui: {},
    offlineReminder: {
      channel: 'webhook',
      reloginUrlMode: 'none',
      endpoint: '',
      token: '',
      title: '账号下线提醒',
      msg: '账号下线',
      offlineDeleteSec: 0,
    },
    trialConfig: {
      enabled: true,
      days: 1,
      adminRenewEnabled: true,
      userRenewEnabled: false,
      maxAccounts: 1,
      dailyLimit: 50,
      cooldownMs: 4 * 60 * 60 * 1000,
    },
    thirdPartyApi: {
      wxApiKey: '',
      wxApiUrl: '',
      wxAppId: '',
    },
    workflowConfig: {
      farm: { enabled: false, minInterval: 30, maxInterval: 120, nodes: [] },
      friend: { enabled: false, minInterval: 60, maxInterval: 300, nodes: [] },
    },
    timingConfig: {
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
    },
    defaultTimingConfig: {
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
    },
    readonlyTimingParams: [],
    clusterConfig: {
      dispatcherStrategy: 'round_robin',
    },
  })
  const loading = ref(false)
  const timingLoading = ref(false)
  const reportLogs = ref<ReportLogEntry[]>([])
  const reportLogPagination = ref<ReportLogPagination>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  })

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.strategy || 'preferred'
        settings.value.preferredSeedId = d.preferredSeed || 0
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.tradeConfig = d.tradeConfig || {
          sell: {
            scope: 'fruit_only',
            keepMinEachFruit: 0,
            keepFruitIds: [],
            rareKeep: {
              enabled: false,
              judgeBy: 'either',
              minPlantLevel: 40,
              minUnitPrice: 2000,
            },
            batchSize: 15,
            previewBeforeManualSell: false,
          },
        }
        settings.value.automation = d.automation || {}
        settings.value.reportConfig = d.reportConfig || {
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
        settings.value.ui = d.ui || {}
        // 蹲守配置挂到 settings 上层以便 StealSettings.vue 读取
        ; (settings.value as any).stakeoutSteal = d.stakeoutSteal || { enabled: false, delaySec: 3 }
        settings.value.workflowConfig = d.workflowConfig || { farm: { enabled: false, minInterval: 30, maxInterval: 120, nodes: [] }, friend: { enabled: false, minInterval: 60, maxInterval: 300, nodes: [] } }
        settings.value.offlineReminder = d.offlineReminder || {
          channel: 'webhook',
          reloginUrlMode: 'none',
          endpoint: '',
          token: '',
          title: '账号下线提醒',
          msg: '账号下线',
          offlineDeleteSec: 0,
        }
      }
    }
    finally {
      loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    // 不设置 loading，避免整页切换导致闪烁；Settings.vue 已用 saving 控制按钮加载态
    try {
      // 1. Save general settings
      const settingsPayload: Record<string, any> = {
        plantingStrategy: newSettings.plantingStrategy,
        preferredSeedId: newSettings.preferredSeedId,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
        tradeConfig: newSettings.tradeConfig,
      }
      // 蹲守配置透传
      // 工作流配置透传
      if (newSettings.workflowConfig) {
        settingsPayload.workflowConfig = newSettings.workflowConfig
      }
      if (newSettings.stakeoutSteal) {
        settingsPayload.stakeoutSteal = newSettings.stakeoutSteal
      }
      if (newSettings.reportConfig) {
        settingsPayload.reportConfig = newSettings.reportConfig
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      // 2. Save automation settings
      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      // Refresh settings
      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      // loading 未在此处修改，无需 finally 中重置
    }
  }

  async function saveOfflineConfig(config: OfflineConfig) {
    // 不设置 loading，避免整页切换导致闪烁；Settings.vue 已用 offlineSaving 控制按钮加载态
    try {
      const user = JSON.parse(localStorage.getItem('current_user') || 'null')
      if (user?.role !== 'admin')
        return { ok: false, error: '仅管理员可修改下线提醒设置' }

      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = data.data || config
        return { ok: true }
      }
      return { ok: false, error: data?.error || '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '保存失败' }
    }
    finally {
      // loading 未在此处修改，无需 finally 中重置
    }
  }

  async function sendReportTest(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/reports/test', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok)
        return { ok: true, data: data.data }
      return { ok: false, error: data?.error || '发送失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '发送失败' }
    }
  }

  async function sendReport(accountId: string, mode: 'hourly' | 'daily') {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/reports/send', { mode }, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok)
        return { ok: true, data: data.data }
      return { ok: false, error: data?.error || '发送失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '发送失败' }
    }
  }

  async function fetchReportLogs(accountId: string, options: { page?: number, pageSize?: number, limit?: number, mode?: string, status?: string, sortOrder?: string, keyword?: string } = {}) {
    if (!accountId) {
      reportLogs.value = []
      reportLogPagination.value = { page: 1, pageSize: 10, total: 0, totalPages: 1 }
      return reportLogPagination.value
    }
    try {
      const page = options.page ?? 1
      const pageSize = options.pageSize ?? options.limit ?? 10
      const { data } = await api.get('/api/reports/history', {
        headers: { 'x-account-id': accountId },
        params: {
          page,
          pageSize,
          mode: options.mode || '',
          status: options.status || '',
          sortOrder: options.sortOrder || 'desc',
          keyword: options.keyword || '',
        },
      })
      if (data && data.ok && data.data && Array.isArray(data.data.items)) {
        reportLogs.value = data.data.items
        reportLogPagination.value = {
          page: Number(data.data.page) || 1,
          pageSize: Number(data.data.pageSize) || pageSize,
          total: Number(data.data.total) || 0,
          totalPages: Math.max(1, Number(data.data.totalPages) || 1),
        }
        return reportLogPagination.value
      }
      reportLogs.value = []
      reportLogPagination.value = { page: 1, pageSize: Number(pageSize) || 10, total: 0, totalPages: 1 }
      return reportLogPagination.value
    }
    catch (e) {
      console.error('获取经营汇报历史失败:', e)
      reportLogs.value = []
      reportLogPagination.value = { page: 1, pageSize: 10, total: 0, totalPages: 1 }
      return reportLogPagination.value
    }
  }

  async function clearReportLogs(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.delete('/api/reports/history', {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok) {
        reportLogs.value = []
        reportLogPagination.value = { page: 1, pageSize: reportLogPagination.value.pageSize || 10, total: 0, totalPages: 1 }
        return { ok: true, data: data.data }
      }
      return { ok: false, error: data?.error || '清空失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '清空失败' }
    }
  }

  async function deleteReportLogsByIds(accountId: string, ids: number[]) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)))
    if (normalizedIds.length === 0)
      return { ok: false, error: '未选择任何记录' }
    try {
      const { data } = await api.delete('/api/reports/history/items', {
        headers: { 'x-account-id': accountId },
        data: { ids: normalizedIds },
      })
      if (data && data.ok)
        return { ok: true, data: data.data }
      return { ok: false, error: data?.error || '删除失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '删除失败' }
    }
  }

  async function exportReportLogs(accountId: string, options: { mode?: string, status?: string, sortOrder?: string, keyword?: string } = {}) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const response = await api.get('/api/reports/history/export', {
        headers: { 'x-account-id': accountId },
        params: {
          mode: options.mode || '',
          status: options.status || '',
          sortOrder: options.sortOrder || 'desc',
          keyword: options.keyword || '',
        },
        responseType: 'blob',
      })
      const disposition = String(response.headers['content-disposition'] || '')
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      return {
        ok: true,
        blob: response.data,
        filename: filenameMatch ? filenameMatch[1] : 'report-history.csv',
        count: Number(response.headers['x-export-count']) || 0,
        total: Number(response.headers['x-export-total']) || 0,
        truncated: String(response.headers['x-export-truncated'] || '0') === '1',
      }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message || '导出失败' }
    }
  }

  /**
   * 修改当前登录用户的密码（自动隔离，基于 token 识别用户）
   */
  async function changePassword(oldPassword: string, newPassword: string) {
    // 不设置 loading，避免整页切换导致闪烁；Settings.vue 已用 passwordSaving 控制按钮加载态
    try {
      const res = await api.post('/api/auth/change-password', { oldPassword, newPassword })
      return res.data
    }
    catch (e: any) {
      // axios 对 4xx/5xx 状态码会抛异常，需要从 response.data 中提取后端错误信息
      const backendError = e.response?.data?.error
      return { ok: false, error: backendError || e.message || '密码修改失败' }
    }
  }

  async function fetchTrialCardConfig() {
    try {
      const { data } = await api.get('/api/trial-card-config')
      if (data && data.ok && data.data) {
        settings.value.trialConfig = data.data
      }
      return data?.data
    }
    catch (e) {
      console.error('获取体验卡配置失败:', e)
    }
  }

  async function fetchThirdPartyApiConfig() {
    try {
      const { data } = await api.get('/api/admin/third-party-api')
      if (data && data.ok && data.data) {
        settings.value.thirdPartyApi = data.data
      }
      return data?.data
    }
    catch (e) {
      console.error('获取第三方 API 配置失败:', e)
    }
  }

  async function saveThirdPartyApiConfig(config: ThirdPartyApiConfig) {
    // 不设置 loading，避免整页切换导致闪烁；Settings.vue 已用 thirdPartyApiSaving 控制按钮加载态
    try {
      const { data } = await api.post('/api/admin/third-party-api', config)
      if (data && data.ok) {
        settings.value.thirdPartyApi = config
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      // loading 未在此处修改，无需 finally 中重置
    }
  }

  async function fetchTimingConfig() {
    timingLoading.value = true
    try {
      const { data } = await api.get('/api/settings/timing-config')
      if (data && data.ok && data.data) {
        settings.value.timingConfig = {
          ...settings.value.timingConfig,
          ...(data.data.config || {}),
        }
        settings.value.defaultTimingConfig = {
          ...settings.value.defaultTimingConfig,
          ...(data.data.defaults || {}),
        }
        settings.value.readonlyTimingParams = data.data.readonlyParams || []
        return data.data
      }
    }
    catch (e) {
      console.error('获取时间参数配置失败:', e)
    }
    finally {
      timingLoading.value = false
    }
  }

  async function saveTimingConfig(config: TimingConfig) {
    try {
      const { data } = await api.post('/api/settings/timing-config', config)
      if (data && data.ok) {
        settings.value.timingConfig = data.data
        return { ok: true }
      }
      return { ok: false, error: data?.error || '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async function fetchClusterConfig() {
    try {
      const u = JSON.parse(localStorage.getItem('current_user') || 'null')
      if (u?.role !== 'admin')
        return

      const { data } = await api.get('/api/admin/cluster-config')
      if (data && data.ok && data.data) {
        settings.value.clusterConfig = data.data
      }
      return data?.data
    }
    catch (e) {
      console.error('获取集群调度配置失败:', e)
    }
  }

  async function saveClusterConfig(config: ClusterConfig) {
    try {
      const { data } = await api.post('/api/admin/cluster-config', config)
      if (data && data.ok) {
        settings.value.clusterConfig = config
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  return { settings, loading, timingLoading, reportLogs, reportLogPagination, fetchSettings, fetchReportLogs, clearReportLogs, deleteReportLogsByIds, exportReportLogs, saveSettings, saveOfflineConfig, sendReportTest, sendReport, changePassword, fetchTrialCardConfig, fetchThirdPartyApiConfig, saveThirdPartyApiConfig, fetchTimingConfig, saveTimingConfig, fetchClusterConfig, saveClusterConfig }
})

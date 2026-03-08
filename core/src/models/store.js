const process = require('node:process');
/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { getPool, transaction } = require('../services/mysql-db');
const { readTextFile, readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const ALLOWED_PLANTING_STRATEGIES = ['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit'];
const PUSHOO_CHANNELS = new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher',
]);
const INTERVAL_MAX_SEC = 86400;
const DEFAULT_OFFLINE_REMINDER = {
    channel: 'webhook',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 0,
};
const DEFAULT_REPORT_CONFIG = {
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
};
const REPORT_OPERATION_KEYS = [
    'harvest',
    'water',
    'weed',
    'bug',
    'fertilize',
    'plant',
    'steal',
    'helpWater',
    'helpWeed',
    'helpBug',
    'taskClaim',
    'sell',
    'upgrade',
    'levelUp',
];
const DEFAULT_REPORT_STATE = {
    lastHourlySlot: '',
    lastDailySlot: '',
    hourlyBaseline: null,
    dailyBaseline: null,
};
const DEFAULT_TRADE_CONFIG = {
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
};
// ============ 全局配置 ============
const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        farm: true,
        farm_manage: true, // 农场打理总开关（浇水/除草/除虫）
        farm_water: true, // 自动浇水
        farm_weed: true, // 自动除草
        farm_bug: true, // 自动除虫
        farm_push: true,   // 收到 LandsNotify 推送时是否立即触发巡田
        land_upgrade: true, // 是否自动升级土地
        friend: true,       // 好友互动总开关
        friend_help_exp_limit: true, // 帮忙经验达上限后自动停止帮忙
        friend_steal: true, // 偷菜
        friend_help: true,  // 帮忙
        friend_bad: false,  // 捣乱(放虫草)
        friend_auto_accept: false,
        friend_three_phase: false,
        auto_blacklist_banned: true,
        task: true,
        email: true,
        fertilizer_gift: false,
        fertilizer_buy: false,
        fertilizer_buy_limit: 100,
        free_gifts: true,
        share_reward: true,
        vip_gift: true,
        month_card: true,
        open_server_gift: true,
        sell: true,
        fertilizer: 'none',
        fertilizer_60s_anti_steal: false,
        fertilizer_smart_phase: false,
        fastHarvest: false,
        landUpgradeTarget: 6,
    },
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    intervals: {
        farm: 30,
        friend: 60,
        farmMin: 30,
        farmMax: 120,
        friendMin: 60,
        friendMax: 180,
        helpMin: 60,
        helpMax: 180,
        stealMin: 60,
        stealMax: 180,
    },
    friendQuietHours: {
        enabled: false,
        start: '23:00',
        end: '07:00',
    },
    friendBlacklist: [],
    stealFilter: { enabled: false, mode: 'blacklist', plantIds: [] },
    stealFriendFilter: { enabled: false, mode: 'blacklist', friendIds: [] },
    stakeoutSteal: { enabled: false, delaySec: 3 },
    skipStealRadish: { enabled: false },
    forceGetAll: { enabled: false },
    workflowConfig: {
        farm: { enabled: false, minInterval: 30, maxInterval: 120, nodes: [] },
        friend: { enabled: false, minInterval: 60, maxInterval: 300, nodes: [] },
    },
    tradeConfig: { ...DEFAULT_TRADE_CONFIG },
    reportConfig: { ...DEFAULT_REPORT_CONFIG },
    reportState: { ...DEFAULT_REPORT_STATE },
};
const ALLOWED_AUTOMATION_KEYS = new Set(Object.keys(DEFAULT_ACCOUNT_CONFIG.automation));
const FERTILIZER_OPTIONS = new Set(['both', 'normal', 'organic', 'none']);

let accountFallbackConfig = {
    ...DEFAULT_ACCOUNT_CONFIG,
    automation: { ...DEFAULT_ACCOUNT_CONFIG.automation },
    intervals: { ...DEFAULT_ACCOUNT_CONFIG.intervals },
    friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
};

const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    ui: {
        theme: 'dark',
    },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    adminPasswordHash: '',
    thirdPartyApi: {},
    timingConfig: {},
    clusterConfig: {
        dispatcherStrategy: 'round_robin', // 'round_robin' or 'least_load'
    },
    suspendUntilMap: {},
};

function normalizeOfflineReminder(input) {
    const src = (input && typeof input === 'object') ? input : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec)) {
        offlineDeleteSec = DEFAULT_OFFLINE_REMINDER.offlineDeleteSec;
    }
    offlineDeleteSec = Math.max(0, offlineDeleteSec);
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const rawReloginUrlMode = (src.reloginUrlMode !== undefined && src.reloginUrlMode !== null)
        ? String(src.reloginUrlMode).trim().toLowerCase()
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const reloginUrlMode = new Set(['none', 'qq_link', 'qr_code', 'all']).has(rawReloginUrlMode)
        ? rawReloginUrlMode
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    return {
        channel,
        reloginUrlMode,
        endpoint,
        token,
        title,
        msg,
        offlineDeleteSec,
    };
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    const base = Number.isFinite(parsed) ? parsed : Number.parseInt(fallback, 10);
    const next = Number.isFinite(base) ? base : min;
    return Math.max(min, Math.min(max, next));
}

function normalizeReportConfig(rawConfig, fallbackConfig = DEFAULT_REPORT_CONFIG) {
    const raw = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const fallback = (fallbackConfig && typeof fallbackConfig === 'object') ? fallbackConfig : DEFAULT_REPORT_CONFIG;
    const rawChannel = String(raw.channel !== undefined ? raw.channel : fallback.channel || DEFAULT_REPORT_CONFIG.channel).trim().toLowerCase();
    return {
        enabled: raw.enabled !== undefined ? !!raw.enabled : !!fallback.enabled,
        channel: PUSHOO_CHANNELS.has(rawChannel) ? rawChannel : DEFAULT_REPORT_CONFIG.channel,
        endpoint: String(raw.endpoint !== undefined ? raw.endpoint : fallback.endpoint || '').trim(),
        token: String(raw.token !== undefined ? raw.token : fallback.token || '').trim(),
        title: String(raw.title !== undefined ? raw.title : fallback.title || DEFAULT_REPORT_CONFIG.title).trim() || DEFAULT_REPORT_CONFIG.title,
        hourlyEnabled: raw.hourlyEnabled !== undefined ? !!raw.hourlyEnabled : !!fallback.hourlyEnabled,
        hourlyMinute: clampInteger(raw.hourlyMinute, fallback.hourlyMinute, 0, 59),
        dailyEnabled: raw.dailyEnabled !== undefined ? !!raw.dailyEnabled : !!fallback.dailyEnabled,
        dailyHour: clampInteger(raw.dailyHour, fallback.dailyHour, 0, 23),
        dailyMinute: clampInteger(raw.dailyMinute, fallback.dailyMinute, 0, 59),
        retentionDays: clampInteger(raw.retentionDays, fallback.retentionDays, 0, 365),
    };
}

function normalizeReportBaseline(rawBaseline) {
    if (!rawBaseline || typeof rawBaseline !== 'object') return null;
    const operations = {};
    for (const key of REPORT_OPERATION_KEYS) {
        operations[key] = Math.max(0, Number.parseInt(rawBaseline.operations && rawBaseline.operations[key], 10) || 0);
    }
    return {
        sessionExpGained: Math.max(0, Number(rawBaseline.sessionExpGained) || 0),
        sessionGoldGained: Math.max(0, Number(rawBaseline.sessionGoldGained) || 0),
        sessionCouponGained: Math.max(0, Number(rawBaseline.sessionCouponGained) || 0),
        operations,
        recordedAt: Math.max(0, Number(rawBaseline.recordedAt) || 0),
    };
}

function normalizeReportState(rawState, fallbackState = DEFAULT_REPORT_STATE) {
    const raw = (rawState && typeof rawState === 'object') ? rawState : {};
    const fallback = (fallbackState && typeof fallbackState === 'object') ? fallbackState : DEFAULT_REPORT_STATE;
    return {
        lastHourlySlot: String(raw.lastHourlySlot !== undefined ? raw.lastHourlySlot : fallback.lastHourlySlot || '').trim(),
        lastDailySlot: String(raw.lastDailySlot !== undefined ? raw.lastDailySlot : fallback.lastDailySlot || '').trim(),
        hourlyBaseline: normalizeReportBaseline(raw.hourlyBaseline !== undefined ? raw.hourlyBaseline : fallback.hourlyBaseline),
        dailyBaseline: normalizeReportBaseline(raw.dailyBaseline !== undefined ? raw.dailyBaseline : fallback.dailyBaseline),
    };
}

function normalizeWorkflowLane(rawLane, fallbackLane) {
    const raw = (rawLane && typeof rawLane === 'object') ? rawLane : {};
    const fallback = (fallbackLane && typeof fallbackLane === 'object') ? fallbackLane : { enabled: false, minInterval: 30, maxInterval: 120, nodes: [] };
    const minInterval = Math.max(1, Number.parseInt(raw.minInterval, 10) || Number.parseInt(fallback.minInterval, 10) || 1);
    const maxInterval = Math.max(minInterval, Number.parseInt(raw.maxInterval, 10) || Number.parseInt(fallback.maxInterval, 10) || minInterval);
    return {
        enabled: raw.enabled !== undefined ? !!raw.enabled : !!fallback.enabled,
        minInterval,
        maxInterval,
        nodes: Array.isArray(raw.nodes)
            ? raw.nodes.map(node => ({ ...(node || {}) }))
            : (Array.isArray(fallback.nodes) ? fallback.nodes.map(node => ({ ...(node || {}) })) : []),
    };
}

function normalizeWorkflowConfig(rawWorkflow, fallbackWorkflow = DEFAULT_ACCOUNT_CONFIG.workflowConfig) {
    const raw = (rawWorkflow && typeof rawWorkflow === 'object') ? rawWorkflow : {};
    const fallback = (fallbackWorkflow && typeof fallbackWorkflow === 'object') ? fallbackWorkflow : DEFAULT_ACCOUNT_CONFIG.workflowConfig;
    return {
        farm: normalizeWorkflowLane(raw.farm, fallback.farm || DEFAULT_ACCOUNT_CONFIG.workflowConfig.farm),
        friend: normalizeWorkflowLane(raw.friend, fallback.friend || DEFAULT_ACCOUNT_CONFIG.workflowConfig.friend),
    };
}

function normalizeTradeConfig(rawTrade, fallbackTrade = DEFAULT_TRADE_CONFIG) {
    const raw = (rawTrade && typeof rawTrade === 'object') ? rawTrade : {};
    const fallback = (fallbackTrade && typeof fallbackTrade === 'object') ? fallbackTrade : DEFAULT_TRADE_CONFIG;
    const rawSell = (raw.sell && typeof raw.sell === 'object') ? raw.sell : {};
    const fallbackSell = (fallback.sell && typeof fallback.sell === 'object') ? fallback.sell : DEFAULT_TRADE_CONFIG.sell;
    const rawRareKeep = (rawSell.rareKeep && typeof rawSell.rareKeep === 'object') ? rawSell.rareKeep : {};
    const fallbackRareKeep = (fallbackSell.rareKeep && typeof fallbackSell.rareKeep === 'object')
        ? fallbackSell.rareKeep
        : DEFAULT_TRADE_CONFIG.sell.rareKeep;
    const judgeBy = new Set(['plant_level', 'unit_price', 'either']).has(String(rawRareKeep.judgeBy || ''))
        ? String(rawRareKeep.judgeBy)
        : String(fallbackRareKeep.judgeBy || DEFAULT_TRADE_CONFIG.sell.rareKeep.judgeBy);

    return {
        sell: {
            scope: 'fruit_only',
            keepMinEachFruit: clampInteger(rawSell.keepMinEachFruit, fallbackSell.keepMinEachFruit, 0, 999999),
            keepFruitIds: Array.isArray(rawSell.keepFruitIds)
                ? rawSell.keepFruitIds.map(Number).filter(id => Number.isFinite(id) && id > 0)
                : (Array.isArray(fallbackSell.keepFruitIds) ? fallbackSell.keepFruitIds.map(Number).filter(id => Number.isFinite(id) && id > 0) : []),
            rareKeep: {
                enabled: rawRareKeep.enabled !== undefined ? !!rawRareKeep.enabled : !!fallbackRareKeep.enabled,
                judgeBy,
                minPlantLevel: clampInteger(rawRareKeep.minPlantLevel, fallbackRareKeep.minPlantLevel, 0, 999),
                minUnitPrice: clampInteger(rawRareKeep.minUnitPrice, fallbackRareKeep.minUnitPrice, 0, 999999999),
            },
            batchSize: clampInteger(rawSell.batchSize, fallbackSell.batchSize, 1, 50),
            previewBeforeManualSell: rawSell.previewBeforeManualSell !== undefined
                ? !!rawSell.previewBeforeManualSell
                : !!fallbackSell.previewBeforeManualSell,
        },
    };
}

function normalizeAutomationValue(key, value, fallback) {
    if (key === 'fertilizer') {
        return FERTILIZER_OPTIONS.has(value) ? value : fallback;
    }
    if (key === 'fertilizer_buy_limit') {
        const parsed = Number.parseInt(value, 10);
        const next = Number.isFinite(parsed) ? parsed : Number.parseInt(fallback, 10);
        return Math.max(1, Math.min(9999, Number.isFinite(next) ? next : 100));
    }
    if (key === 'landUpgradeTarget') {
        const parsed = Number.parseInt(value, 10);
        const next = Number.isFinite(parsed) ? parsed : Number.parseInt(fallback, 10);
        return Math.max(0, Math.min(6, Number.isFinite(next) ? next : 6));
    }
    return !!value;
}

function cloneAccountConfig(base = DEFAULT_ACCOUNT_CONFIG) {
    const srcAutomation = (base && base.automation && typeof base.automation === 'object')
        ? base.automation
        : {};
    const automation = { ...DEFAULT_ACCOUNT_CONFIG.automation };
    for (const key of Object.keys(automation)) {
        if (srcAutomation[key] !== undefined) {
            automation[key] = normalizeAutomationValue(key, srcAutomation[key], automation[key]);
        }
    }

    const rawBlacklist = Array.isArray(base.friendBlacklist) ? base.friendBlacklist : [];
    const stealFilter = (base.stealFilter && typeof base.stealFilter === 'object')
        ? { enabled: !!base.stealFilter.enabled, mode: base.stealFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist', plantIds: Array.isArray(base.stealFilter.plantIds) ? base.stealFilter.plantIds.map(String) : [] }
        : DEFAULT_ACCOUNT_CONFIG.stealFilter;
    const stealFriendFilter = (base.stealFriendFilter && typeof base.stealFriendFilter === 'object')
        ? { enabled: !!base.stealFriendFilter.enabled, mode: base.stealFriendFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist', friendIds: Array.isArray(base.stealFriendFilter.friendIds) ? base.stealFriendFilter.friendIds.map(String) : [] }
        : DEFAULT_ACCOUNT_CONFIG.stealFriendFilter;
    const stakeoutSteal = (base.stakeoutSteal && typeof base.stakeoutSteal === 'object')
        ? { enabled: !!base.stakeoutSteal.enabled, delaySec: Math.max(1, Number.parseInt(base.stakeoutSteal.delaySec, 10) || 3) }
        : DEFAULT_ACCOUNT_CONFIG.stakeoutSteal;
    const skipStealRadish = (base.skipStealRadish && typeof base.skipStealRadish === 'object')
        ? { enabled: !!base.skipStealRadish.enabled }
        : DEFAULT_ACCOUNT_CONFIG.skipStealRadish;
    const forceGetAll = (base.forceGetAll && typeof base.forceGetAll === 'object')
        ? { enabled: !!base.forceGetAll.enabled }
        : DEFAULT_ACCOUNT_CONFIG.forceGetAll;
    return {
        ...base,
        automation,
        intervals: { ...(base.intervals || DEFAULT_ACCOUNT_CONFIG.intervals) },
        friendQuietHours: { ...(base.friendQuietHours || DEFAULT_ACCOUNT_CONFIG.friendQuietHours) },
        friendBlacklist: rawBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        plantingStrategy: ALLOWED_PLANTING_STRATEGIES.includes(String(base.plantingStrategy || ''))
            ? String(base.plantingStrategy)
            : DEFAULT_ACCOUNT_CONFIG.plantingStrategy,
        preferredSeedId: Math.max(0, Number.parseInt(base.preferredSeedId, 10) || 0),
        stealFilter,
        stealFriendFilter,
        stakeoutSteal,
        skipStealRadish,
        forceGetAll,
        workflowConfig: normalizeWorkflowConfig(base.workflowConfig, DEFAULT_ACCOUNT_CONFIG.workflowConfig),
        tradeConfig: normalizeTradeConfig(base.tradeConfig, DEFAULT_ACCOUNT_CONFIG.tradeConfig),
        reportConfig: normalizeReportConfig(base.reportConfig, DEFAULT_ACCOUNT_CONFIG.reportConfig),
        reportState: normalizeReportState(base.reportState, DEFAULT_ACCOUNT_CONFIG.reportState),
    };
}

function resolveAccountId(accountId) {
    const direct = (accountId !== undefined && accountId !== null) ? String(accountId).trim() : '';
    if (direct) return direct;
    const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
    return envId;
}

function normalizeAccountConfig(input, fallback = accountFallbackConfig) {
    const src = (input && typeof input === 'object') ? input : {};
    const cfg = cloneAccountConfig(fallback || DEFAULT_ACCOUNT_CONFIG);

    if (src.automation && typeof src.automation === 'object') {
        for (const [k, v] of Object.entries(src.automation)) {
            if (!ALLOWED_AUTOMATION_KEYS.has(k)) continue;
            cfg.automation[k] = normalizeAutomationValue(k, v, cfg.automation[k]);
        }
    }

    if (src.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(src.plantingStrategy)) {
        cfg.plantingStrategy = src.plantingStrategy;
    }

    if (src.preferredSeedId !== undefined && src.preferredSeedId !== null) {
        cfg.preferredSeedId = Math.max(0, Number.parseInt(src.preferredSeedId, 10) || 0);
    }

    if (src.intervals && typeof src.intervals === 'object') {
        for (const [type, sec] of Object.entries(src.intervals)) {
            if (cfg.intervals[type] === undefined) continue;
            cfg.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || cfg.intervals[type] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    } else {
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }

    if (src.friendQuietHours && typeof src.friendQuietHours === 'object') {
        const old = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: src.friendQuietHours.enabled !== undefined ? !!src.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(src.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(src.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(src.friendBlacklist)) {
        cfg.friendBlacklist = src.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (src.stealFilter && typeof src.stealFilter === 'object') {
        cfg.stealFilter = {
            enabled: !!src.stealFilter.enabled,
            mode: src.stealFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist',
            plantIds: Array.isArray(src.stealFilter.plantIds) ? src.stealFilter.plantIds.map(String) : (cfg.stealFilter?.plantIds || []),
        };
    }
    if (src.stealFriendFilter && typeof src.stealFriendFilter === 'object') {
        cfg.stealFriendFilter = {
            enabled: !!src.stealFriendFilter.enabled,
            mode: src.stealFriendFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist',
            friendIds: Array.isArray(src.stealFriendFilter.friendIds) ? src.stealFriendFilter.friendIds.map(String) : (cfg.stealFriendFilter?.friendIds || []),
        };
    }
    if (src.stakeoutSteal && typeof src.stakeoutSteal === 'object') {
        cfg.stakeoutSteal = {
            enabled: !!src.stakeoutSteal.enabled,
            delaySec: Math.max(1, Number.parseInt(src.stakeoutSteal.delaySec, 10) || 3),
        };
    }
    if (src.skipStealRadish && typeof src.skipStealRadish === 'object') {
        cfg.skipStealRadish = { enabled: !!src.skipStealRadish.enabled };
    }
    if (src.forceGetAll && typeof src.forceGetAll === 'object') {
        cfg.forceGetAll = { enabled: !!src.forceGetAll.enabled };
    }
    if (src.workflowConfig && typeof src.workflowConfig === 'object') {
        cfg.workflowConfig = normalizeWorkflowConfig(src.workflowConfig, cfg.workflowConfig || DEFAULT_ACCOUNT_CONFIG.workflowConfig);
    } else {
        cfg.workflowConfig = normalizeWorkflowConfig(cfg.workflowConfig, DEFAULT_ACCOUNT_CONFIG.workflowConfig);
    }

    if (src.tradeConfig && typeof src.tradeConfig === 'object') {
        cfg.tradeConfig = normalizeTradeConfig(src.tradeConfig, cfg.tradeConfig || DEFAULT_ACCOUNT_CONFIG.tradeConfig);
    } else {
        cfg.tradeConfig = normalizeTradeConfig(cfg.tradeConfig, DEFAULT_ACCOUNT_CONFIG.tradeConfig);
    }

    if (src.reportConfig && typeof src.reportConfig === 'object') {
        cfg.reportConfig = normalizeReportConfig(src.reportConfig, cfg.reportConfig || DEFAULT_ACCOUNT_CONFIG.reportConfig);
    } else {
        cfg.reportConfig = normalizeReportConfig(cfg.reportConfig, DEFAULT_ACCOUNT_CONFIG.reportConfig);
    }

    if (src.reportState && typeof src.reportState === 'object') {
        cfg.reportState = normalizeReportState(src.reportState, cfg.reportState || DEFAULT_ACCOUNT_CONFIG.reportState);
    } else {
        cfg.reportState = normalizeReportState(cfg.reportState, DEFAULT_ACCOUNT_CONFIG.reportState);
    }

    return cfg;
}

function getAccountConfigSnapshot(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId, nextConfig, persist = true) {
    const id = resolveAccountId(accountId);
    if (!id) {
        accountFallbackConfig = normalizeAccountConfig(nextConfig, accountFallbackConfig);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
        if (persist) saveGlobalConfig();
        return cloneAccountConfig(accountFallbackConfig);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(nextConfig, accountFallbackConfig);
    if (persist) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId, options = {}) {
    const id = resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(globalConfig.defaultAccountConfig, accountFallbackConfig);
    // 新账号默认不施肥（不受历史 defaultAccountConfig 旧值影响）
    if (globalConfig.accountConfigs[id] && globalConfig.accountConfigs[id].automation) {
        globalConfig.accountConfigs[id].automation.fertilizer = 'none';
    }
    if (options.persist !== false) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// 加载全局配置
async function loadGlobalConfigFromDB() {
    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT * FROM account_configs');
        accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
        globalConfig.accountConfigs = {};

        for (const r of rows) {
            let automation = {};
            if (r.automation_farm === 1) automation.farm = true;
            if (r.automation_farm_push === 1) automation.farm_push = true;
            if (r.automation_land_upgrade === 1) automation.land_upgrade = true;
            if (r.automation_friend === 1) automation.friend = true;
            if (r.automation_friend_steal === 1) automation.friend_steal = true;
            if (r.automation_friend_help === 1) automation.friend_help = true;
            if (r.automation_task === 1) automation.task = true;
            if (r.automation_email === 1) automation.email = true;

            let adv = {};
            if (r.advanced_settings) {
                try { adv = JSON.parse(r.advanced_settings); } catch (err) { }
            }
            if (adv.automation && typeof adv.automation === 'object') {
                automation = { ...automation, ...adv.automation };
            }

            globalConfig.accountConfigs[r.account_id] = normalizeAccountConfig({
                automation,
                plantingStrategy: r.planting_strategy,
                preferredSeedId: r.preferred_seed_id,
                intervals: adv.intervals || {},
                friendQuietHours: adv.friendQuietHours || {},
                friendBlacklist: adv.friendBlacklist || [],
                stealFilter: adv.stealFilter,
                stealFriendFilter: adv.stealFriendFilter,
                stakeoutSteal: adv.stakeoutSteal,
                skipStealRadish: adv.skipStealRadish,
                forceGetAll: adv.forceGetAll,
                workflowConfig: adv.workflowConfig,
                reportConfig: adv.reportConfig,
                reportState: adv.reportState,
            }, accountFallbackConfig);

            if (adv.ui) {
                globalConfig.ui = { ...globalConfig.ui, ...adv.ui };
            }

            // Cluster Config (Optional backwards compat from adv)
            if (adv.clusterConfig) {
                globalConfig.clusterConfig = { ...globalConfig.clusterConfig, ...adv.clusterConfig };
            }
        }

    } catch (e) {
        console.error('加载全局配置失败:', e.message);
    }
}
function loadGlobalConfig() { }

function sanitizeGlobalConfigBeforeSave() {
    // default 配置统一白名单净化
    accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

    const currentAccountIds = new Set(
        normalizeAccountsData(loadAccounts()).accounts
            .map(acc => String((acc && acc.id) || '').trim())
            .filter(Boolean)
    );
    const hasLoadedAccountSnapshot = _accountsLoadedAt > 0;

    // 每个账号配置也统一净化
    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        if (hasLoadedAccountSnapshot && !currentAccountIds.has(sid)) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
    }
    globalConfig.accountConfigs = nextMap;
}

// 保存全局配置 (加入 3000ms 防抖，避免狂刷数据库事务阻塞连接池)
let _globalConfigSaveTimer = null;
function saveGlobalConfigImmediate() {
    sanitizeGlobalConfigBeforeSave();
    const pool = getPool();
    try {
        transaction(async (conn) => {
            for (const [id, cfg] of Object.entries(globalConfig.accountConfigs)) {
                const advSetting = JSON.stringify({
                    automation: cfg.automation || {},
                    intervals: cfg.intervals || {},
                    friendQuietHours: cfg.friendQuietHours || {},
                    friendBlacklist: cfg.friendBlacklist || [],
                    stealFilter: cfg.stealFilter || { enabled: false, mode: 'blacklist', plantIds: [] },
                    stealFriendFilter: cfg.stealFriendFilter || { enabled: false, mode: 'blacklist', friendIds: [] },
                    stakeoutSteal: cfg.stakeoutSteal || { enabled: false, delaySec: 3 },
                    skipStealRadish: cfg.skipStealRadish || { enabled: false },
                    forceGetAll: cfg.forceGetAll || { enabled: false },
                    workflowConfig: normalizeWorkflowConfig(cfg.workflowConfig, DEFAULT_ACCOUNT_CONFIG.workflowConfig),
                    reportConfig: normalizeReportConfig(cfg.reportConfig, DEFAULT_ACCOUNT_CONFIG.reportConfig),
                    reportState: normalizeReportState(cfg.reportState, DEFAULT_ACCOUNT_CONFIG.reportState),
                    ui: globalConfig.ui || {},
                    clusterConfig: globalConfig.clusterConfig || { dispatcherStrategy: 'round_robin' }
                });
                const automationKeys = cfg.automation || {};
                await conn.query(`
                    INSERT INTO account_configs (account_id, planting_strategy, preferred_seed_id, 
                    automation_farm, automation_farm_push, automation_land_upgrade,
                    automation_friend, automation_friend_steal, automation_friend_help,
                    automation_friend_bad, automation_task, automation_email,
                    automation_free_gifts, automation_share_reward, automation_vip_gift,
                    automation_month_card, automation_sell, automation_fertilizer,
                    advanced_settings) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    planting_strategy=VALUES(planting_strategy), preferred_seed_id=VALUES(preferred_seed_id),
                    automation_farm=VALUES(automation_farm), automation_farm_push=VALUES(automation_farm_push), automation_land_upgrade=VALUES(automation_land_upgrade),
                    automation_friend=VALUES(automation_friend), automation_friend_steal=VALUES(automation_friend_steal), automation_friend_help=VALUES(automation_friend_help),
                    automation_friend_bad=VALUES(automation_friend_bad), automation_task=VALUES(automation_task), automation_email=VALUES(automation_email),
                    automation_free_gifts=VALUES(automation_free_gifts), automation_share_reward=VALUES(automation_share_reward), automation_vip_gift=VALUES(automation_vip_gift),
                    automation_month_card=VALUES(automation_month_card), automation_sell=VALUES(automation_sell), automation_fertilizer=VALUES(automation_fertilizer),
                    advanced_settings=VALUES(advanced_settings)
                `, [
                    id, cfg.plantingStrategy || 'preferred', cfg.preferredSeedId || 0,
                    automationKeys.farm === false ? 0 : 1, automationKeys.farm_push === false ? 0 : 1, automationKeys.land_upgrade === false ? 0 : 1,
                    automationKeys.friend === false ? 0 : 1, automationKeys.friend_steal === false ? 0 : 1, automationKeys.friend_help === false ? 0 : 1,
                    automationKeys.friend_bad === true ? 1 : 0, automationKeys.task === false ? 0 : 1, automationKeys.email === false ? 0 : 1,
                    automationKeys.free_gifts === false ? 0 : 1, automationKeys.share_reward === false ? 0 : 1, automationKeys.vip_gift === false ? 0 : 1,
                    automationKeys.month_card === false ? 0 : 1, automationKeys.sell === false ? 0 : 1, automationKeys.fertilizer || 'none',
                    advSetting
                ]);
            }
        }).catch(err => console.error("Update Global Config DB Error: ", err.message));
    } catch (e) { console.error('保存全局配置失败:', e.message); }
}

function saveGlobalConfig() {
    if (_globalConfigSaveTimer) clearTimeout(_globalConfigSaveTimer);
    _globalConfigSaveTimer = setTimeout(() => {
        _globalConfigSaveTimer = null;
        saveGlobalConfigImmediate();
    }, 3000);
}

function getAdminPasswordHash() {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash) {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

// 初始化加载
loadGlobalConfig();

function getAutomation(accountId) {
    return { ...getAccountConfigSnapshot(accountId).automation };
}

function getConfigSnapshot(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        preferredSeedId: cfg.preferredSeedId,
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        friendBlacklist: [...(cfg.friendBlacklist || [])],
        workflowConfig: normalizeWorkflowConfig(cfg.workflowConfig, DEFAULT_ACCOUNT_CONFIG.workflowConfig),
        tradeConfig: normalizeTradeConfig(cfg.tradeConfig, DEFAULT_ACCOUNT_CONFIG.tradeConfig),
        reportConfig: normalizeReportConfig(cfg.reportConfig, DEFAULT_ACCOUNT_CONFIG.reportConfig),
        ui: { ...globalConfig.ui },
    };
}

function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    const persist = options.persist !== false;
    const accountId = options.accountId;

    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);

    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(cfg.automation)) {
            if (next.automation[k] === undefined) continue;
            next.automation[k] = normalizeAutomationValue(k, v, next.automation[k]);
        }
    }

    if (cfg.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(cfg.plantingStrategy)) {
        next.plantingStrategy = cfg.plantingStrategy;
    }

    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        next.preferredSeedId = Math.max(0, Number.parseInt(cfg.preferredSeedId, 10) || 0);
    }

    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if (next.intervals[type] === undefined) continue;
            next.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || next.intervals[type] || 1);
        }
        next.intervals = normalizeIntervals(next.intervals);
    }

    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = next.friendQuietHours || {};
        next.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(cfg.friendBlacklist)) {
        next.friendBlacklist = cfg.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (cfg.ui && typeof cfg.ui === 'object') {
        const theme = String(cfg.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
    }

    if (cfg.stealFilter && typeof cfg.stealFilter === 'object') {
        next.stealFilter = {
            enabled: !!cfg.stealFilter.enabled,
            mode: cfg.stealFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist',
            plantIds: Array.isArray(cfg.stealFilter.plantIds) ? cfg.stealFilter.plantIds.map(String) : (next.stealFilter?.plantIds || []),
        };
    }

    if (cfg.stealFriendFilter && typeof cfg.stealFriendFilter === 'object') {
        next.stealFriendFilter = {
            enabled: !!cfg.stealFriendFilter.enabled,
            mode: cfg.stealFriendFilter.mode === 'whitelist' ? 'whitelist' : 'blacklist',
            friendIds: Array.isArray(cfg.stealFriendFilter.friendIds) ? cfg.stealFriendFilter.friendIds.map(String) : (next.stealFriendFilter?.friendIds || []),
        };
    }

    if (cfg.stakeoutSteal && typeof cfg.stakeoutSteal === 'object') {
        next.stakeoutSteal = {
            enabled: !!cfg.stakeoutSteal.enabled,
            delaySec: Math.max(0, Number.parseInt(cfg.stakeoutSteal.delaySec, 10) || 0),
        };
    }

    if (cfg.skipStealRadish && typeof cfg.skipStealRadish === 'object') {
        next.skipStealRadish = { enabled: !!cfg.skipStealRadish.enabled };
    }

    if (cfg.forceGetAll && typeof cfg.forceGetAll === 'object') {
        next.forceGetAll = { enabled: !!cfg.forceGetAll.enabled };
    }

    if (cfg.workflowConfig && typeof cfg.workflowConfig === 'object') {
        next.workflowConfig = normalizeWorkflowConfig(cfg.workflowConfig, next.workflowConfig || DEFAULT_ACCOUNT_CONFIG.workflowConfig);
    }

    if (cfg.tradeConfig && typeof cfg.tradeConfig === 'object') {
        next.tradeConfig = normalizeTradeConfig(cfg.tradeConfig, next.tradeConfig || DEFAULT_ACCOUNT_CONFIG.tradeConfig);
    }

    if (cfg.reportConfig && typeof cfg.reportConfig === 'object') {
        next.reportConfig = normalizeReportConfig(cfg.reportConfig, next.reportConfig || DEFAULT_ACCOUNT_CONFIG.reportConfig);
    }

    if (cfg.reportState && typeof cfg.reportState === 'object') {
        next.reportState = normalizeReportState(cfg.reportState, next.reportState || DEFAULT_ACCOUNT_CONFIG.reportState);
    }

    setAccountConfigSnapshot(accountId, next, false);
    if (persist) saveGlobalConfig();
    return getConfigSnapshot(accountId);
}

function setAutomation(key, value, accountId) {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}

function isAutomationOn(key, accountId) {
    return !!getAccountConfigSnapshot(accountId).automation[key];
}

function getPreferredSeed(accountId) {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}

function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function normalizeIntervals(intervals) {
    const src = (intervals && typeof intervals === 'object') ? intervals : {};
    const toSec = (v, d) => {
        const n = Number.parseInt(v, 10);
        const base = Number.isFinite(n) ? n : d;
        return Math.max(1, Math.min(INTERVAL_MAX_SEC, base));
    };
    const farm = toSec(src.farm, 2);
    const friend = toSec(src.friend, 10);

    let farmMin = toSec(src.farmMin, farm);
    let farmMax = toSec(src.farmMax, farm);
    if (farmMin > farmMax) [farmMin, farmMax] = [farmMax, farmMin];

    let friendMin = toSec(src.friendMin, friend);
    let friendMax = toSec(src.friendMax, friend);
    if (friendMin > friendMax) [friendMin, friendMax] = [friendMax, friendMin];

    let helpMin = toSec(src.helpMin, friendMin);
    let helpMax = toSec(src.helpMax, friendMax);
    if (helpMin > helpMax) [helpMin, helpMax] = [helpMax, helpMin];

    let stealMin = toSec(src.stealMin, friendMin);
    let stealMax = toSec(src.stealMax, friendMax);
    if (stealMin > stealMax) [stealMin, stealMax] = [stealMax, stealMin];

    return {
        ...src,
        farm,
        friend,
        farmMin,
        farmMax,
        friendMin,
        friendMax,
        helpMin,
        helpMax,
        stealMin,
        stealMax,
    };
}

function normalizeTimeString(v, fallback) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return fallback;
    const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getTradeConfig(accountId) {
    return normalizeTradeConfig(getAccountConfigSnapshot(accountId).tradeConfig, DEFAULT_ACCOUNT_CONFIG.tradeConfig);
}

function setTradeConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.tradeConfig = normalizeTradeConfig(cfg, next.tradeConfig || DEFAULT_ACCOUNT_CONFIG.tradeConfig);
    setAccountConfigSnapshot(accountId, next);
    return getTradeConfig(accountId);
}

function getFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

function setFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}

function getStealFilterConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).stealFilter || { enabled: false, mode: 'blacklist', plantIds: [] }) };
}

function setStealFilterConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.stealFilter = {
        enabled: !!cfg.enabled,
        mode: cfg.mode === 'whitelist' ? 'whitelist' : 'blacklist',
        plantIds: Array.isArray(cfg.plantIds) ? cfg.plantIds.map(String) : [],
    };
    setAccountConfigSnapshot(accountId, next);
    return getStealFilterConfig(accountId);
}

function getStealFriendFilterConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).stealFriendFilter || { enabled: false, mode: 'blacklist', friendIds: [] }) };
}

function setStealFriendFilterConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.stealFriendFilter = {
        enabled: !!cfg.enabled,
        mode: cfg.mode === 'whitelist' ? 'whitelist' : 'blacklist',
        friendIds: Array.isArray(cfg.friendIds) ? cfg.friendIds.map(String) : [],
    };
    setAccountConfigSnapshot(accountId, next);
    return getStealFriendFilterConfig(accountId);
}

function getStakeoutStealConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).stakeoutSteal || { enabled: false, delaySec: 3 }) };
}

function setStakeoutStealConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.stakeoutSteal = {
        enabled: !!cfg.enabled,
        delaySec: Math.max(1, Math.min(300, Number.parseInt(cfg.delaySec, 10) || 3)),
    };
    setAccountConfigSnapshot(accountId, next);
    return getStakeoutStealConfig(accountId);
}

function getSkipStealRadishConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).skipStealRadish || { enabled: false }) };
}

function setSkipStealRadishConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.skipStealRadish = { enabled: !!(cfg && cfg.enabled) };
    setAccountConfigSnapshot(accountId, next);
    return getSkipStealRadishConfig(accountId);
}

function getForceGetAllConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).forceGetAll || { enabled: false }) };
}

function setForceGetAllConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.forceGetAll = { enabled: !!(cfg && cfg.enabled) };
    setAccountConfigSnapshot(accountId, next);
    return getForceGetAllConfig(accountId);
}

function getReportConfig(accountId) {
    return { ...(getAccountConfigSnapshot(accountId).reportConfig || DEFAULT_REPORT_CONFIG) };
}

function setReportConfig(accountId, cfg) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.reportConfig = normalizeReportConfig({ ...next.reportConfig, ...(cfg || {}) }, next.reportConfig || DEFAULT_REPORT_CONFIG);
    setAccountConfigSnapshot(accountId, next);
    return getReportConfig(accountId);
}

function getReportState(accountId) {
    return normalizeReportState(getAccountConfigSnapshot(accountId).reportState, DEFAULT_REPORT_STATE);
}

function setReportState(accountId, state) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.reportState = normalizeReportState({ ...next.reportState, ...(state || {}) }, next.reportState || DEFAULT_REPORT_STATE);
    setAccountConfigSnapshot(accountId, next);
    return getReportState(accountId);
}

function getUI() {
    return { ...globalConfig.ui };
}

function setUITheme(theme) {
    const t = String(theme || '').toLowerCase();
    const next = (t === 'light') ? 'light' : 'dark';
    return applyConfigSnapshot({ ui: { theme: next } });
}

function getOfflineReminder() {
    return normalizeOfflineReminder(globalConfig.offlineReminder);
}

function setOfflineReminder(cfg) {
    const current = normalizeOfflineReminder(globalConfig.offlineReminder);
    globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder();
}

function parseAccountAuthData(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    return {};
}

// ============ 账号管理 ============
async function loadAccountsFromDB() {
    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT * FROM accounts');
        let mapped = rows.map((r) => {
            const authData = parseAccountAuthData(r.auth_data);
            const platform = r.platform || 'qq';
            const uin = String(r.uin || authData.uin || '').trim();
            const qq = String(authData.qq || (platform === 'qq' ? uin : '')).trim();
            return {
                id: r.id,
                uin,
                code: r.code || authData.code || '',
                nick: r.nick || '',
                name: r.name || '',
                platform,
                running: r.running === 1,
                avatar: r.avatar || '',
                qq,
                authTicket: String(authData.authTicket || '').trim(),
                username: r.username || '',
                createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
                updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
            };
        });
        cachedAccountsData = normalizeAccountsData({ accounts: mapped, nextId: 1000 + mapped.length });
        _accountsLoadedAt = Date.now();
        return cachedAccountsData;
    } catch (e) { console.error('加载账号数据失败:', e.message); }
    return cachedAccountsData;
}

let cachedAccountsData = { accounts: [], nextId: 1 };
let _accountsLoadedAt = 0;
let _accountsRefreshPromise = null;
function loadAccounts() {
    return cachedAccountsData;
}

function cloneAccountsData(data) {
    const normalized = normalizeAccountsData(data);
    return {
        nextId: normalized.nextId,
        accounts: normalized.accounts.map(acc => ({ ...acc })),
    };
}

let _accountsSaveTimer = null;
let _pendingAccountPersistIds = new Set();

function queueAccountPersistIds(data, touchedAccountIds) {
    const normalized = normalizeAccountsData(data);
    const ids = Array.isArray(touchedAccountIds)
        ? touchedAccountIds
        : (touchedAccountIds !== undefined && touchedAccountIds !== null ? [touchedAccountIds] : normalized.accounts.map(acc => acc && acc.id));
    ids
        .map(id => String(id || '').trim())
        .filter(Boolean)
        .forEach(id => _pendingAccountPersistIds.add(id));
}

function saveAccounts(data, touchedAccountIds) {
    cachedAccountsData = normalizeAccountsData(data); // 内存立即生效
    _accountsLoadedAt = Date.now();
    queueAccountPersistIds(cachedAccountsData, touchedAccountIds);
    if (_accountsSaveTimer) clearTimeout(_accountsSaveTimer);

    _accountsSaveTimer = setTimeout(() => {
        _accountsSaveTimer = null;
        const pool = getPool();
        const snapshot = cloneAccountsData(cachedAccountsData);
        const pendingIds = Array.from(_pendingAccountPersistIds);
        _pendingAccountPersistIds = new Set();
        try {
            for (const accountId of pendingIds) {
                const acc = snapshot.accounts.find(item => String(item && item.id) === String(accountId));
                if (!acc) continue;
                const platform = acc.platform || 'qq';
                const primaryUin = platform === 'qq'
                    ? String(acc.uin || acc.qq || '').trim()
                    : String(acc.uin || '').trim();
                const authData = JSON.stringify({
                    uin: String(acc.uin || '').trim(),
                    qq: String(acc.qq || '').trim(),
                    code: acc.code || '',
                    authTicket: String(acc.authTicket || '').trim(),
                });
                pool.query(
                    "INSERT INTO accounts (id, uin, nick, name, platform, running, code, username, avatar, auth_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE uin=COALESCE(NULLIF(VALUES(uin),''), uin), nick=VALUES(nick), name=VALUES(name), platform=VALUES(platform), running=VALUES(running), code=COALESCE(NULLIF(VALUES(code),''), code), username=COALESCE(NULLIF(VALUES(username),''), username), avatar=COALESCE(NULLIF(VALUES(avatar),''), avatar), auth_data=COALESCE(NULLIF(VALUES(auth_data),''), auth_data)",
                    [
                        acc.id,
                        primaryUin,
                        acc.nick || '',
                        acc.name || '',
                        platform,
                        acc.running ? 1 : 0,
                        acc.code || '',
                        acc.username || '',
                        acc.avatar || '',
                        authData,
                    ]
                ).catch(e => console.error("DB Async Insert Account Failed", e.message));
            }
        } catch (e) {
            console.error('保存账号数据失败:', e.message);
        }
    }, 2000);
}

function getAccounts() {
    return loadAccounts();
}

async function getAccountsFresh(options = {}) {
    const force = !!(options && options.force);
    const maxAgeMs = Number.parseInt(options && options.maxAgeMs, 10) || 1500;
    const hasCache = Array.isArray(cachedAccountsData.accounts) && cachedAccountsData.accounts.length > 0;
    const cacheIsFresh = hasCache && !force && (Date.now() - _accountsLoadedAt) <= maxAgeMs;

    if (cacheIsFresh) {
        return cloneAccountsData(cachedAccountsData);
    }
    if (_accountsRefreshPromise) {
        return _accountsRefreshPromise;
    }

    _accountsRefreshPromise = loadAccountsFromDB()
        .catch(() => cachedAccountsData)
        .then(data => cloneAccountsData(data || cachedAccountsData))
        .finally(() => {
            _accountsRefreshPromise = null;
        });

    return _accountsRefreshPromise;
}

async function getAccountFull(accountId) {
    const id = String(accountId || '').trim();
    if (!id) return null;

    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT * FROM accounts WHERE id = ? LIMIT 1', [id]);
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) return null;
        let authData = row.auth_data;
        if (typeof authData === 'string' && authData) {
            try { authData = JSON.parse(authData); } catch { authData = null; }
        }
        return {
            id: row.id,
            uin: row.uin ? String(row.uin) : String((authData && authData.uin) || ''),
            qq: String((authData && authData.qq) || (row.platform === 'qq' ? (row.uin ? String(row.uin) : '') : '')),
            code: row.code || (authData && authData.code) || '',
            authTicket: String((authData && authData.authTicket) || ''),
            nick: row.nick || '',
            name: row.name || '',
            platform: row.platform || 'qq',
            running: row.running === 1 || row.running === true,
            avatar: row.avatar || '',
            username: row.username || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        };
    } catch (e) {
        const data = getAccounts();
        const list = Array.isArray(data.accounts) ? data.accounts : [];
        const found = list.find(a => String(a.id || '') === id);
        return found ? { ...found } : null;
    }
}

function normalizeAccountsData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const maxId = accounts.reduce((m, a) => Math.max(m, Number.parseInt(a && a.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { accounts, nextId };
}

function addOrUpdateAccount(acc) {
    const data = normalizeAccountsData(loadAccounts());
    let touchedAccountId = '';
    if (acc.id) {
        const accIdStr = String(acc.id).trim();
        const idx = data.accounts.findIndex(a => String(a.id).trim() === accIdStr);
        if (idx >= 0) {
            data.accounts[idx] = { ...data.accounts[idx], ...acc, name: acc.name !== undefined ? acc.name : data.accounts[idx].name, updatedAt: Date.now() };
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        const id = data.nextId++;
        touchedAccountId = String(id);
        data.accounts.push({
            id: touchedAccountId,
            name: acc.name || `账号${id}`,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : ((acc.platform || 'qq') === 'qq' && acc.uin ? String(acc.uin) : ''),
            authTicket: acc.authTicket ? String(acc.authTicket) : '',
            avatar: acc.avatar || acc.avatarUrl || '',
            username: acc.username || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
    saveAccounts(data, touchedAccountId);
    if (touchedAccountId) {
        ensureAccountConfig(touchedAccountId);
    }
    return data;
}

function deleteAccount(id) {
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => String(a.id) !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data, String(id || ''));
    removeAccountConfig(id);

    // 修复 bug：仅 saveAccounts(data) 会触发 UPSERT（更新或插入），但不会对被 filter 剔除的数据做 DELETE，必须单独在 DB 中删除该行
    const pool = getPool();
    if (pool) {
        pool.query('DELETE FROM accounts WHERE id = ?', [String(id)]).catch(e => console.error("DB Delete Account Failed:", e.message));
        // 同时清理可能关联的 config 数据
        pool.query('DELETE FROM account_configs WHERE account_id = ?', [String(id)]).catch(e => console.error("DB Delete Account Configs Failed:", e.message));
    }

    return data;
}

// ============ 系统级时间参数配置 (Ghosting / 限流 / 邀请延迟等) ============
const DEFAULT_TIMING_CONFIG = {
    // Ghosting 打盹参数
    ghostingCooldownMin: 240,       // 冷却期（分钟），两次打盹之间最少间隔
    ghostingProbability: 0.02,      // 每次巡查触发打盹的概率
    ghostingMinMin: 5,              // 最短打盹时长（分钟）
    ghostingMaxMin: 10,             // 最长打盹时长（分钟）
    // 令牌桶限流参数
    rateLimitIntervalMs: 334,       // 两次 WS 请求之间的最小间隔（毫秒）
    // 邀请码处理延迟
    inviteRequestDelay: 2000,       // 邀请码逐条处理间隔（毫秒）
    // 调度器引擎
    schedulerEngine: 'hybrid',      // default | optimized | hybrid
    optimizedSchedulerNamespaces: 'system-jobs,account-report-service,worker_manager',
    optimizedSchedulerTickMs: 100,
    optimizedSchedulerWheelSize: 600,
};

// ============ 体验卡相关配置 ============
const DEFAULT_TRIAL_CARD_CONFIG = {
    enabled: true,           // 是否允许生成体验卡
    dailyLimit: 100,         // 每日最大发卡数量
    cooldownMs: 4 * 60 * 60 * 1000, // IP申请冷却时间 (默认 4 小时)
    days: 1,                 // 体验卡默认天数
    maxAccounts: 1,          // 结合使用，体验卡最多只能添加 1 个账号
    adminRenewEnabled: true, // 管理员是否可以一键续费该类型
    userRenewEnabled: false, // 用户是否可以自助续费该类型
};

/**
 * 获取系统级时间参数配置（合并默认值）
 */
function getTimingConfig() {
    const saved = (globalConfig.timingConfig && typeof globalConfig.timingConfig === 'object')
        ? globalConfig.timingConfig
        : {};
    return { ...DEFAULT_TIMING_CONFIG, ...saved };
}

/**
 * 保存系统级时间参数配置（局部更新）
 */
function setTimingConfig(cfg) {
    const current = getTimingConfig();
    const input = (cfg && typeof cfg === 'object') ? cfg : {};
    const next = {};
    for (const key of Object.keys(DEFAULT_TIMING_CONFIG)) {
        if (input[key] !== undefined) {
            if (typeof DEFAULT_TIMING_CONFIG[key] === 'number') {
                next[key] = Number(input[key]);
                if (!Number.isFinite(next[key])) next[key] = current[key];
            } else {
                next[key] = String(input[key] ?? current[key] ?? DEFAULT_TIMING_CONFIG[key]).trim();
                if (!next[key]) next[key] = DEFAULT_TIMING_CONFIG[key];
            }
        } else {
            next[key] = current[key];
        }
    }
    globalConfig.timingConfig = next;
    saveGlobalConfig();
    return getTimingConfig();
}

/**
 * 获取体验卡配置（合并默认值）
 */
function getTrialCardConfig() {
    const saved = (globalConfig.trialCardConfig && typeof globalConfig.trialCardConfig === 'object')
        ? globalConfig.trialCardConfig
        : {};
    return { ...DEFAULT_TRIAL_CARD_CONFIG, ...saved };
}

/**
 * 保存体验卡配置（局部更新）
 */
function setTrialCardConfig(cfg) {
    const current = getTrialCardConfig();
    const input = (cfg && typeof cfg === 'object') ? cfg : {};
    const next = {};
    for (const key of Object.keys(DEFAULT_TRIAL_CARD_CONFIG)) {
        if (input[key] !== undefined) {
            if (typeof DEFAULT_TRIAL_CARD_CONFIG[key] === 'boolean') {
                next[key] = !!input[key];
            } else {
                next[key] = Number(input[key]);
                if (!Number.isFinite(next[key])) next[key] = current[key];
            }
        } else {
            next[key] = current[key];
        }
    }
    globalConfig.trialCardConfig = next;
    saveGlobalConfig();
    return getTrialCardConfig();
}

// ============ 风控休眠持久化 ============
/**
 * 记录账号休眠到期时间戳（持久化到 store.json）
 */
function recordSuspendUntil(accountId, timestamp) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (!globalConfig.suspendUntilMap) globalConfig.suspendUntilMap = {};
    globalConfig.suspendUntilMap[id] = timestamp;
    saveGlobalConfig();
}

/**
 * 读取账号的休眠到期时间戳
 */
function getSuspendUntil(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return 0;
    if (!globalConfig.suspendUntilMap) return 0;
    return Number(globalConfig.suspendUntilMap[id]) || 0;
}

async function loadAllFromDB() {
    await loadAccountsFromDB();
    await loadGlobalConfigFromDB();
}

module.exports = {
    loadAllFromDB,
    DEFAULT_ACCOUNT_CONFIG,
    DEFAULT_TIMING_CONFIG,
    DEFAULT_TRADE_CONFIG,
    getAccountConfigSnapshot,
    setAccountConfigSnapshot,
    removeAccountConfig,
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPlantingStrategy,
    getPreferredSeed,
    getIntervals,
    getFriendQuietHours,
    getTradeConfig,
    setTradeConfig,
    getFriendBlacklist,
    setFriendBlacklist,
    getStealFilterConfig,
    setStealFilterConfig,
    getStealFriendFilterConfig,
    setStealFriendFilterConfig,
    getStakeoutStealConfig,
    setStakeoutStealConfig,
    getSkipStealRadishConfig,
    setSkipStealRadishConfig,
    getForceGetAllConfig,
    setForceGetAllConfig,
    getReportConfig,
    setReportConfig,
    getReportState,
    setReportState,
    getUI,
    setUITheme,
    getOfflineReminder,
    setOfflineReminder,
    getTimingConfig,
    setTimingConfig,
    getSuspendUntil,
    recordSuspendUntil,
    ensureAccountConfig,
    addOrUpdateAccount,
    deleteAccount,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getAccounts,
    getAccountsFresh,
    getAccountFull,
    getThirdPartyApiConfig,
    setThirdPartyApiConfig,
    getTrialCardConfig,
    setTrialCardConfig,

    getClusterConfig: () => {
        if (!globalConfig.clusterConfig) {
            globalConfig.clusterConfig = { dispatcherStrategy: 'round_robin' };
        }
        return { ...globalConfig.clusterConfig };
    },
    setClusterConfig: (cfg) => {
        globalConfig.clusterConfig = { ...globalConfig.clusterConfig, ...(cfg || {}) };
        saveGlobalConfig();
        return { ...globalConfig.clusterConfig };
    }
};

function getAccountsFullPaged(page = 1, pageSize = 20) {
    const data = getAccounts();
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];

    // Sort by id descending (newest first)
    const sortedAccounts = [...accounts].sort((a, b) => {
        const idA = Number.parseInt(a.id, 10) || 0;
        const idB = Number.parseInt(b.id, 10) || 0;
        return idB - idA;
    });

    const total = sortedAccounts.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pagedAccounts = sortedAccounts.slice(startIndex, endIndex);

    return {
        accounts: pagedAccounts,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
    };
}

function getThirdPartyApiConfig() {
    return { ...(globalConfig.thirdPartyApi || {}) };
}

function setThirdPartyApiConfig(cfg) {
    const current = getThirdPartyApiConfig();
    globalConfig.thirdPartyApi = { ...current, ...(cfg || {}) };
    saveGlobalConfig();
    return getThirdPartyApiConfig();
}

module.exports.getAccountsFullPaged = getAccountsFullPaged;
module.exports.getThirdPartyApiConfig = getThirdPartyApiConfig;
module.exports.setThirdPartyApiConfig = setThirdPartyApiConfig;

const process = require('node:process');
const { createModuleLogger } = require('./logger');
const { createOptimizedScheduler } = require('./scheduler-optimized');

const schedulerLogger = createModuleLogger('scheduler');
const schedulerRegistry = new Map(); // namespace -> { createdAt, engine, scheduler, timers, engineOptions }

function toDelayMs(value, fallbackMs = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(0, fallbackMs | 0);
    return Math.max(0, Math.floor(n));
}

function parseNamespaceList(raw) {
    return new Set(
        String(raw || '')
            .split(/[,\s]+/)
            .map(item => item.trim())
            .filter(Boolean)
    );
}

function normalizeTaskSnapshot(taskName, meta) {
    const item = meta || {};
    return {
        name: String(taskName || ''),
        kind: item.kind || 'timeout',
        delayMs: Math.max(0, Number(item.delayMs) || 0),
        createdAt: Number(item.createdAt) || 0,
        nextRunAt: Number(item.nextRunAt) || 0,
        lastRunAt: Number(item.lastRunAt) || 0,
        runCount: Number(item.runCount) || 0,
        running: !!item.running,
        preventOverlap: item.preventOverlap !== false,
    };
}

function resolveEngineConfig(namespace, options = {}) {
    let timingConfig = {};
    try {
        const store = require('../models/store');
        timingConfig = store && typeof store.getTimingConfig === 'function'
            ? (store.getTimingConfig() || {})
            : {};
    } catch {
        timingConfig = {};
    }

    const requestedMode = String(
        options.engine
        || timingConfig.schedulerEngine
        || process.env.FARM_SCHEDULER_ENGINE
        || 'default'
    ).trim().toLowerCase();
    const mode = new Set(['default', 'optimized', 'hybrid']).has(requestedMode)
        ? requestedMode
        : 'default';
    const whitelist = parseNamespaceList(
        options.optimizedNamespaces
        || timingConfig.optimizedSchedulerNamespaces
        || process.env.FARM_OPTIMIZED_SCHEDULER_NAMESPACES
        || ''
    );
    let engine = 'default';
    if (mode === 'optimized') {
        engine = 'optimized';
    } else if (mode === 'hybrid') {
        engine = whitelist.has(namespace) ? 'optimized' : 'default';
    } else if (whitelist.has(namespace)) {
        engine = 'optimized';
    }

    return {
        engine,
        mode,
        tickMs: Math.max(10, Number(options.tickMs || timingConfig.optimizedSchedulerTickMs || process.env.FARM_OPTIMIZED_SCHEDULER_TICK_MS || 100) || 100),
        wheelSize: Math.max(10, Number(options.wheelSize || timingConfig.optimizedSchedulerWheelSize || process.env.FARM_OPTIMIZED_SCHEDULER_WHEEL_SIZE || 600) || 600),
    };
}

function ensureNamespaceRecord(namespace, engineConfig) {
    const key = String(namespace || 'default');
    const existed = schedulerRegistry.get(key);
    if (existed) return existed;
    const created = {
        namespace: key,
        createdAt: Date.now(),
        engine: engineConfig.engine || 'default',
        engineMode: engineConfig.mode || 'default',
        engineOptions: {
            tickMs: engineConfig.tickMs,
            wheelSize: engineConfig.wheelSize,
        },
        scheduler: null,
        timers: new Map(),
    };
    schedulerRegistry.set(key, created);
    return created;
}

function buildDefaultSnapshot(record) {
    const tasks = [];
    for (const [taskName, meta] of record.timers.entries()) {
        tasks.push(normalizeTaskSnapshot(taskName, meta));
    }
    tasks.sort((a, b) => a.name.localeCompare(b.name));
    return {
        namespace: record.namespace,
        createdAt: Number(record.createdAt) || 0,
        engine: 'default',
        engineMode: record.engineMode || 'default',
        taskCount: tasks.length,
        tasks,
    };
}

function createDefaultScheduler(record) {
    const name = record.namespace;
    const timers = record.timers;

    function clear(taskName) {
        const key = String(taskName || '');
        const entry = timers.get(key);
        if (!entry) return false;
        timers.delete(key);
        if (entry.kind === 'interval') {
            clearTimeout(entry.handle);
        } else {
            clearTimeout(entry.handle);
        }
        return true;
    }

    function clearAll() {
        const keys = Array.from(timers.keys());
        for (const key of keys) clear(key);
    }

    function setTimeoutTask(taskName, delayMs, taskFn) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`timeout 任务 ${key} 缺少回调函数`);
        clear(key);
        const delay = toDelayMs(delayMs, 0);
        const entry = {
            kind: 'timeout',
            delayMs: delay,
            createdAt: Date.now(),
            nextRunAt: Date.now() + delay,
            lastRunAt: 0,
            runCount: 0,
            running: false,
            preventOverlap: true,
            handle: null,
        };
        const handle = setTimeout(async () => {
            const current = timers.get(key);
            if (!current || current.handle !== handle) return;
            current.running = true;
            current.lastRunAt = Date.now();
            current.runCount += 1;
            try {
                await taskFn();
            } catch (e) {
                schedulerLogger.warn(`[${name}] timeout 任务执行失败: ${key}`, {
                    module: 'scheduler',
                    scope: name,
                    task: key,
                    error: e && e.message ? e.message : String(e),
                });
            } finally {
                const after = timers.get(key);
                if (after && after.handle === handle) {
                    timers.delete(key);
                }
            }
        }, delay);
        entry.handle = handle;
        timers.set(key, entry);
        return handle;
    }

    function setIntervalTask(taskName, intervalMs, taskFn, options = {}) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`interval 任务 ${key} 缺少回调函数`);
        clear(key);

        const delay = Math.max(1, toDelayMs(intervalMs, 1000));
        const preventOverlap = options.preventOverlap !== false;
        const runImmediately = !!options.runImmediately;

        const entry = {
            kind: 'interval',
            delayMs: delay,
            createdAt: Date.now(),
            nextRunAt: Date.now() + delay,
            lastRunAt: 0,
            runCount: 0,
            running: false,
            preventOverlap,
            handle: null,
            expectedNext: Date.now() + delay,
        };

        const runner = async () => {
            const current = timers.get(key);
            if (!current) return;

            await new Promise(resolve => setImmediate(resolve));

            if (preventOverlap && current.running) {
                current.expectedNext += delay;
                queueNext(delay);
                return;
            }

            current.running = true;
            current.lastRunAt = Date.now();
            current.runCount += 1;

            try {
                await taskFn();
            } catch (e) {
                schedulerLogger.warn(`[${name}] interval 任务执行失败: ${key}`, {
                    module: 'scheduler',
                    scope: name,
                    task: key,
                    error: e && e.message ? e.message : String(e),
                });
            } finally {
                const updated = timers.get(key);
                if (updated) {
                    updated.running = false;
                    updated.expectedNext += delay;
                    const now = Date.now();
                    let nextDelay = updated.expectedNext - now;
                    if (nextDelay < 0) {
                        updated.expectedNext = now + delay;
                        nextDelay = delay;
                    }
                    updated.nextRunAt = now + nextDelay;
                    queueNext(nextDelay);
                }
            }
        };

        const queueNext = (ms) => {
            const current = timers.get(key);
            if (current) {
                current.handle = setTimeout(runner, ms);
            }
        };

        if (runImmediately) {
            entry.expectedNext = Date.now();
            Promise.resolve().then(runner).catch(() => null);
        } else {
            entry.handle = setTimeout(runner, delay);
        }

        timers.set(key, entry);
        return entry;
    }

    function has(taskName) {
        return timers.has(String(taskName || ''));
    }

    function getTaskNames() {
        return Array.from(timers.keys());
    }

    function clearByKeyword(keyword) {
        if (!keyword) return 0;
        const keys = Array.from(timers.keys());
        let count = 0;
        for (const key of keys) {
            if (key.includes(keyword)) {
                clear(key);
                count++;
            }
        }
        return count;
    }

    function getSnapshot() {
        return buildDefaultSnapshot(record);
    }

    return {
        setTimeoutTask,
        setIntervalTask,
        clear,
        clearAll,
        has,
        getTaskNames,
        getSnapshot,
        clearByKeyword,
        engine: 'default',
    };
}

function createOptimizedSchedulerWrapper(record, engineConfig) {
    const scheduler = createOptimizedScheduler(record.namespace, {
        tickMs: engineConfig.tickMs,
        wheelSize: engineConfig.wheelSize,
    });

    function clearByKeyword(keyword) {
        if (!keyword) return 0;
        const keys = scheduler.getTaskNames();
        let count = 0;
        for (const key of keys) {
            if (String(key).includes(keyword)) {
                scheduler.clear(key);
                count++;
            }
        }
        return count;
    }

    function getSnapshot() {
        const base = scheduler.getSnapshot() || {};
        const tasks = Array.isArray(base.tasks) ? base.tasks.map(task => normalizeTaskSnapshot(task.name, task)) : [];
        return {
            namespace: record.namespace,
            createdAt: Number(record.createdAt) || 0,
            engine: 'optimized',
            engineMode: record.engineMode || 'hybrid',
            engineOptions: {
                tickMs: engineConfig.tickMs,
                wheelSize: engineConfig.wheelSize,
            },
            taskCount: Number(base.taskCount) || tasks.length,
            tasks,
            wheel: base.wheel || null,
        };
    }

    return {
        setTimeoutTask: (...args) => scheduler.setTimeoutTask(...args),
        setIntervalTask: (...args) => scheduler.setIntervalTask(...args),
        clear: (...args) => scheduler.clear(...args),
        clearAll: () => scheduler.clearAll(),
        has: (...args) => scheduler.has(...args),
        getTaskNames: () => scheduler.getTaskNames(),
        getSnapshot,
        clearByKeyword,
        destroy: () => scheduler.destroy(),
        engine: 'optimized',
    };
}

function getSchedulerRegistrySnapshot(namespace = '') {
    const ns = String(namespace || '').trim();
    const list = [];
    for (const [name, record] of schedulerRegistry.entries()) {
        if (ns && name !== ns) continue;
        if (!record.scheduler) continue;
        const snapshot = record.scheduler.getSnapshot();
        list.push({
            ...snapshot,
            namespace: name,
            createdAt: Number(record.createdAt) || Number(snapshot.createdAt) || 0,
        });
    }
    list.sort((a, b) => a.namespace.localeCompare(b.namespace));
    return {
        generatedAt: Date.now(),
        schedulerCount: list.length,
        schedulers: list,
    };
}

function createScheduler(namespace = 'default', options = {}) {
    const name = String(namespace || 'default');
    const existed = schedulerRegistry.get(name);
    if (existed && existed.scheduler) {
        return existed.scheduler;
    }

    const engineConfig = resolveEngineConfig(name, options);
    const record = ensureNamespaceRecord(name, engineConfig);
    record.engine = engineConfig.engine;
    record.engineMode = engineConfig.mode;
    record.engineOptions = {
        tickMs: engineConfig.tickMs,
        wheelSize: engineConfig.wheelSize,
    };
    record.scheduler = engineConfig.engine === 'optimized'
        ? createOptimizedSchedulerWrapper(record, engineConfig)
        : createDefaultScheduler(record);

    schedulerLogger.info(`调度器已创建: ${name}`, {
        module: 'scheduler',
        scope: name,
        engine: engineConfig.engine,
        mode: engineConfig.mode,
        tickMs: engineConfig.tickMs,
        wheelSize: engineConfig.wheelSize,
    });

    return record.scheduler;
}

module.exports = {
    createScheduler,
    getSchedulerRegistrySnapshot,
};

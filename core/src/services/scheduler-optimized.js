/**
 * 时间轮调度器 (Hierarchical Timing Wheel)
 *
 * 替代 setTimeout 模式，在大量定时任务场景下性能更优。
 * O(1) 的任务插入和删除，O(1) 的 tick 推进。
 *
 * 注意：本模块由 scheduler.js 统一接管，业务层不应直接依赖本文件。
 * 兼容现有 scheduler.js 接口，并支持按 namespace 灰度切换。
 */

const { createModuleLogger } = require('./logger');

const schedulerLogger = createModuleLogger('scheduler-optimized');

// ============ 定时任务节点 ============

class TimerNode {
    constructor(taskName, callback, delayMs, kind = 'timeout', options = {}) {
        this.taskName = taskName;
        this.callback = callback;
        this.delayMs = Math.max(0, delayMs);
        this.kind = kind;
        this.createdAt = Date.now();
        this.nextRunAt = Date.now() + this.delayMs;
        this.lastRunAt = 0;
        this.runCount = 0;
        this.running = false;
        this.cancelled = false;
        this.preventOverlap = options.preventOverlap !== false;
        this.runImmediately = !!options.runImmediately;

        this._wheelSlot = -1;
        this._remainingRounds = 0;
    }

    cancel() {
        this.cancelled = true;
    }
}

// ============ 时间轮 ============

class TimeWheel {
    /**
     * @param {object} opts
     * @param {number} opts.tickMs    - tick 粒度(ms)，默认 100ms
     * @param {number} opts.wheelSize - 轮槽位数量，默认 600 (60秒 / 100ms)
     */
    constructor({ tickMs = 100, wheelSize = 600 } = {}) {
        this.tickMs = Math.max(10, tickMs);
        this.wheelSize = Math.max(10, wheelSize);
        this.slots = new Array(this.wheelSize).fill(null).map(() => []);
        this.currentSlot = 0;
        this.tickCount = 0;
        this._timer = null;
        this._running = false;
    }

    /**
     * 将任务节点插入时间轮
     * @param {TimerNode} node
     */
    insert(node) {
        if (node.cancelled) return;

        const ticksUntilFire = Math.max(1, Math.ceil(node.delayMs / this.tickMs));
        const totalSlots = this.wheelSize;

        if (ticksUntilFire <= totalSlots) {
            const targetSlot = (this.currentSlot + ticksUntilFire) % totalSlots;
            node._wheelSlot = targetSlot;
            node._remainingRounds = 0;
            this.slots[targetSlot].push(node);
        } else {
            node._remainingRounds = Math.floor(ticksUntilFire / totalSlots);
            const targetSlot = (this.currentSlot + (ticksUntilFire % totalSlots)) % totalSlots;
            node._wheelSlot = targetSlot;
            this.slots[targetSlot].push(node);
        }
    }

    /**
     * 移除任务
     * @param {TimerNode} node
     */
    remove(node) {
        node.cancel();
        if (node._wheelSlot >= 0 && node._wheelSlot < this.wheelSize) {
            const slot = this.slots[node._wheelSlot];
            const idx = slot.indexOf(node);
            if (idx >= 0) slot.splice(idx, 1);
        }
    }

    /**
     * 启动时间轮
     * @param {Function} onFire - 任务到期回调 (node) => void
     */
    start(onFire) {
        if (this._running) return;
        this._running = true;

        this._timer = setInterval(() => {
            this.currentSlot = (this.currentSlot + 1) % this.wheelSize;
            this.tickCount++;

            const slot = this.slots[this.currentSlot];
            const fireList = [];
            const keepList = [];

            for (const node of slot) {
                if (node.cancelled) continue;

                if (node._remainingRounds > 0) {
                    node._remainingRounds--;
                    keepList.push(node);
                } else {
                    fireList.push(node);
                }
            }

            this.slots[this.currentSlot] = keepList;

            for (const node of fireList) {
                onFire(node);
            }
        }, this.tickMs);
    }

    stop() {
        this._running = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    getStatus() {
        let totalTasks = 0;
        for (const slot of this.slots) {
            totalTasks += slot.filter(n => !n.cancelled).length;
        }
        return {
            running: this._running,
            tickMs: this.tickMs,
            wheelSize: this.wheelSize,
            currentSlot: this.currentSlot,
            tickCount: this.tickCount,
            totalTasks,
        };
    }
}

// ============ 高性能调度器 ============

class OptimizedScheduler {
    /**
     * @param {string} namespace
     * @param {object} opts
     * @param {number} opts.tickMs    - tick 粒度，默认 100ms
     * @param {number} opts.wheelSize - 轮槽位数，默认 600
     */
    constructor(namespace = 'default', opts = {}) {
        this.namespace = namespace;
        this.wheel = new TimeWheel(opts);
        this.tasks = new Map();
        this._started = false;

        this.wheel.start((node) => this._onFire(node));
        this._started = true;
    }

    async _onFire(node) {
        if (node.cancelled) return;

        if (node.preventOverlap && node.running) return;

        node.running = true;
        node.lastRunAt = Date.now();
        node.runCount++;

        try {
            await node.callback();
        } catch (e) {
            schedulerLogger.warn(`[${this.namespace}] 任务执行失败: ${node.taskName}`, {
                module: 'scheduler-optimized',
                scope: this.namespace,
                task: node.taskName,
                error: e && e.message ? e.message : String(e),
            });
        } finally {
            node.running = false;

            if (node.kind === 'timeout') {
                this.tasks.delete(node.taskName);
            } else if (node.kind === 'interval' && !node.cancelled) {
                node.nextRunAt = Date.now() + node.delayMs;
                this.wheel.insert(node);
            }
        }
    }

    /**
     * 设置超时任务（兼容 scheduler.js 接口）
     */
    setTimeoutTask(taskName, delayMs, taskFn) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`任务 ${key} 缺少回调函数`);

        this.clear(key);

        const node = new TimerNode(key, taskFn, delayMs, 'timeout');
        this.tasks.set(key, node);
        this.wheel.insert(node);
        return node;
    }

    /**
     * 设置间隔任务（兼容 scheduler.js 接口）
     */
    setIntervalTask(taskName, intervalMs, taskFn, options = {}) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`任务 ${key} 缺少回调函数`);

        this.clear(key);

        const node = new TimerNode(key, taskFn, intervalMs, 'interval', options);
        this.tasks.set(key, node);

        if (options.runImmediately) {
            Promise.resolve().then(() => this._onFire(node)).catch(() => null);
        } else {
            this.wheel.insert(node);
        }

        return node;
    }

    clear(taskName) {
        const key = String(taskName || '');
        const node = this.tasks.get(key);
        if (!node) return false;
        this.wheel.remove(node);
        this.tasks.delete(key);
        return true;
    }

    clearAll() {
        for (const [key, node] of this.tasks) {
            node.cancel();
        }
        this.tasks.clear();
    }

    has(taskName) {
        return this.tasks.has(String(taskName || ''));
    }

    getTaskNames() {
        return Array.from(this.tasks.keys());
    }

    getSnapshot() {
        const tasks = [];
        for (const [name, node] of this.tasks) {
            tasks.push({
                name,
                kind: node.kind,
                delayMs: node.delayMs,
                createdAt: node.createdAt,
                nextRunAt: node.nextRunAt,
                lastRunAt: node.lastRunAt,
                runCount: node.runCount,
                running: node.running,
                preventOverlap: node.preventOverlap,
            });
        }
        tasks.sort((a, b) => a.name.localeCompare(b.name));
        return {
            namespace: this.namespace,
            createdAt: Date.now(),
            taskCount: tasks.length,
            tasks,
            wheel: this.wheel.getStatus(),
        };
    }

    destroy() {
        this.clearAll();
        this.wheel.stop();
        this._started = false;
    }
}

/**
 * 创建优化调度器（兼容 createScheduler 接口）
 */
function createOptimizedScheduler(namespace = 'default', opts = {}) {
    return new OptimizedScheduler(namespace, opts);
}

module.exports = {
    TimerNode,
    TimeWheel,
    OptimizedScheduler,
    createOptimizedScheduler,
};

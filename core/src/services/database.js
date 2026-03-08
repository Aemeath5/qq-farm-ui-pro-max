const { initMysql, getPool } = require('./mysql-db');
const { initRedis, getRedisClient } = require('./redis-cache');
const { circuitBreaker } = require('./circuit-breaker');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('database');

let initPromise = null;

async function initDatabase() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        try {
            await initMysql();
            logger.info('MySQL initialized');
            try {
                const redisReady = await initRedis();
                if (redisReady) {
                    logger.info('Redis initialized');
                } else {
                    logger.warn('Redis unavailable, continuing in degraded mode');
                }
            } catch (rErr) {
                // Redis 初始化失败：熔断器已在 initRedis 内部自动切换到 OPEN 状态
                logger.error('⚠️ Redis 初始化失败，已启动熔断保护模式。Worker 重度查询将被降级处理。', rErr.message);
            }
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    })();
    return initPromise;
}

function getDb() {
    return getPool();
}

async function closeDatabase() {
    await flushLogBatch();
    const pool = getPool();
    if (pool) {
        await pool.end();
        logger.info('MySQL closed');
    }
}

async function transaction(fn, retries = 1) {
    const pool = getPool();
    let connection;
    try {
        connection = await pool.getConnection();
    } catch (err) {
        if (retries > 0 && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT')) {
            logger.warn(`[database] 获取事务连接抛出 ${err.code}，尝试重试 (剩余: ${retries})`);
            return transaction(fn, retries - 1);
        }
        throw err;
    }

    await connection.beginTransaction();
    try {
        const result = await fn(connection);
        await connection.commit();
        return result;
    } catch (e) {
        await connection.rollback();
        // 如果在事务查询中依然遇到断链，同样消耗重试并重新发配
        if (retries > 0 && (e.code === 'ECONNRESET' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.code === 'ETIMEDOUT')) {
            logger.warn(`[database] 事务执行中抛出断链 ${e.code}，回滚并尝试整体重试 (剩余: ${retries})`);
            connection.release(); // 先释放坏链
            return transaction(fn, retries - 1);
        }
        throw e;
    } finally {
        if (connection && connection.release) {
            try { connection.release(); } catch (ignore) { }
        }
    }
}

// For operations logs:
const logBatch = [];

async function flushLogBatch() {
    if (logBatch.length === 0) return;
    const batch = logBatch.splice(0, logBatch.length);
    try {
        const pool = getPool();
        const values = batch.map(b => [b.accountId, b.action, b.result, b.details]);
        // mysql2/promise `query` handles `[[]]` as batch insert if statement is string: `VALUES ?`
        await pool.query('INSERT INTO operation_logs (account_id, action, result, details, created_at) VALUES ?', [values]);
    } catch (e) {
        logger.error('Batch inserts failed:', e.message);
    }
}

// 日志批量写入 — 缩短到 3 秒刷盘，减少高并发下的堆积
setInterval(() => {
    flushLogBatch().catch(() => { });
}, 3000).unref();

function bufferedInsertLog(accountId, action, result, details) {
    logBatch.push({
        accountId, action, result,
        details: typeof details === 'string' ? details : JSON.stringify(details || {})
    });
    // 阈值从 200 降到 100，避免单次批量 INSERT 过大
    if (logBatch.length >= 100) {
        flushLogBatch().catch(() => { });
    }
}

async function updateFriendsCache(accountId, friendsList, retryCount = 0) {
    try {
        const redis = getRedisClient();
        if (!redis) return;
        const valid = (friendsList || []).filter(f => f && f.gid);
        if (!valid.length) return;

        const mapped = valid.map(f => ({
            gid: Number(f.gid),
            uin: String(f.uin || ''),
            name: String(f.name || f.remark || ''),
            avatarUrl: String(f.avatarUrl || f.avatar_url || '')
        }));

        await redis.set(`account:${accountId}:friends_cache`, JSON.stringify(mapped), 'EX', 86400 * 3); // 3 days Cache
    } catch (e) {
        logger.error(`save friends cache failed: ${e.message}`);
    }
}

async function getCachedFriends(accountId) {
    // 熔断器检查：Redis 不可用时直接返回空数组，防止回源 MySQL 造成雪崩
    if (!circuitBreaker.isAvailable()) {
        logger.warn(`Redis 熔断中，跳过好友缓存查询 (account: ${accountId})`);
        return [];
    }
    try {
        const redis = getRedisClient();
        if (!redis) return [];
        const str = await redis.get(`account:${accountId}:friends_cache`);
        circuitBreaker.recordSuccess();
        if (str) return JSON.parse(str);
        return [];
    } catch (e) {
        circuitBreaker.recordFailure();
        logger.error(`get friends cache failed: ${e.message}`);
        return [];
    }
}

/**
 * 检查 Redis 缓存是否可用（供 Worker 层查询）
 */
function isRedisCacheAvailable() {
    return circuitBreaker.isAvailable();
}

// ============ 公告管理 (支持多版本历史) ============
const ANNOUNCEMENT_CACHE_KEY = 'announcements:list';
const ANNOUNCEMENT_CACHE_TTL = 300; // 5 分钟

async function getAnnouncements() {
    try {
        const redis = getRedisClient();
        if (redis) {
            const cached = await redis.get(ANNOUNCEMENT_CACHE_KEY);
            if (cached) return JSON.parse(cached);
        }
    } catch (e) {
        logger.warn(`公告 Redis 缓存读取失败: ${e.message}`);
    }

    const pool = getPool();
    try {
        // 按照 ID 倒序排列获取所有有效和非有效公告
        const [rows] = await pool.execute(
            'SELECT id, title, version, publish_date, content, enabled, created_by, created_at, updated_at FROM announcements ORDER BY id DESC'
        );
        const data = rows.map(row => ({
            id: row.id,
            title: row.title || '',
            version: row.version || '',
            publish_date: row.publish_date || '',
            content: row.content || '',
            enabled: !!row.enabled,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(ANNOUNCEMENT_CACHE_KEY, JSON.stringify(data), 'EX', ANNOUNCEMENT_CACHE_TTL);
            }
        } catch (rErr) { /* ignore */ }
        return data;
    } catch (e) {
        logger.error(`getAnnouncements failed: ${e.message}`);
        return [];
    }
}

async function saveAnnouncement(data) {
    const pool = getPool();
    const { id, title = '', version = '', publish_date = '', content = '', enabled = true, createdBy = null } = data || {};
    try {
        if (id) {
            await pool.execute(
                'UPDATE announcements SET title = ?, version = ?, publish_date = ?, content = ?, enabled = ?, created_by = ? WHERE id = ?',
                [title, version, publish_date, content, enabled ? 1 : 0, createdBy, id]
            );
        } else {
            await pool.execute(
                'INSERT INTO announcements (title, version, publish_date, content, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?)',
                [title, version, publish_date, content, enabled ? 1 : 0, createdBy]
            );
        }
        await invalidateAnnouncementCache();
        return { ok: true };
    } catch (e) {
        logger.error(`saveAnnouncement failed: ${e.message}`);
        throw e;
    }
}

async function deleteAnnouncement(id) {
    const pool = getPool();
    try {
        if (id) {
            await pool.execute('DELETE FROM announcements WHERE id = ?', [id]);
        } else {
            await pool.query('TRUNCATE TABLE announcements'); // 使用 query 代替 execute 并且 TRUNCATE，重置自增顺序
        }
        await invalidateAnnouncementCache();
        return { ok: true };
    } catch (e) {
        logger.error(`deleteAnnouncement failed: ${e.message}`);
        throw e;
    }
}

async function invalidateAnnouncementCache() {
    try {
        const redis = getRedisClient();
        if (redis) await redis.del(ANNOUNCEMENT_CACHE_KEY);
    } catch (e) { /* ignore */ }
}

async function insertReportLog(entry = {}) {
    const pool = getPool();
    if (!pool) return { ok: false };
    const payload = (entry && typeof entry === 'object') ? entry : {};
    await pool.execute(
        `INSERT INTO report_logs
        (account_id, account_name, mode, ok, channel, title, content, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            String(payload.accountId || '').trim(),
            String(payload.accountName || '').trim(),
            String(payload.mode || 'test').trim(),
            payload.ok ? 1 : 0,
            String(payload.channel || '').trim(),
            String(payload.title || '').trim(),
            String(payload.content || ''),
            String(payload.errorMessage || '').trim(),
        ],
    );
    return { ok: true };
}

function normalizeReportLogFilters(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const rawMode = String(opts.mode || '').trim().toLowerCase();
    const rawStatus = String(opts.status || '').trim().toLowerCase();
    const rawSortOrder = String(opts.sortOrder !== undefined ? opts.sortOrder : (opts.order || '')).trim().toLowerCase();
    const keyword = String(opts.keyword !== undefined ? opts.keyword : (opts.q || '')).trim().slice(0, 100);
    const allowedModes = new Set(['test', 'hourly', 'daily']);
    const allowedStatus = new Set(['success', 'failed']);
    const allowedSortOrders = new Set(['asc', 'desc']);
    return {
        mode: allowedModes.has(rawMode) ? rawMode : '',
        status: allowedStatus.has(rawStatus) ? rawStatus : '',
        sortOrder: allowedSortOrders.has(rawSortOrder) ? rawSortOrder : 'desc',
        keyword,
    };
}

function buildReportLogWhereClause(accountId, options = {}) {
    const normalizedAccountId = String(accountId || '').trim();
    const filters = normalizeReportLogFilters(options);
    const params = [normalizedAccountId];
    let whereSql = 'WHERE account_id = ?';
    if (filters.mode) {
        whereSql += ' AND mode = ?';
        params.push(filters.mode);
    }
    if (filters.status) {
        whereSql += filters.status === 'success' ? ' AND ok = 1' : ' AND ok = 0';
    }
    if (filters.keyword) {
        const keywordPattern = `%${filters.keyword}%`;
        whereSql += ' AND (title LIKE ? OR content LIKE ? OR error_message LIKE ?)';
        params.push(keywordPattern, keywordPattern, keywordPattern);
    }
    return { whereSql, params, filters };
}

function mapReportLogRows(rows) {
    return (rows || []).map(row => ({
        id: row.id,
        accountId: String(row.account_id || ''),
        accountName: row.account_name || '',
        mode: row.mode || 'test',
        ok: !!row.ok,
        channel: row.channel || '',
        title: row.title || '',
        content: row.content || '',
        errorMessage: row.error_message || '',
        createdAt: row.created_at,
    }));
}

function createEmptyReportLogStats() {
    return {
        total: 0,
        successCount: 0,
        failedCount: 0,
        testCount: 0,
        hourlyCount: 0,
        dailyCount: 0,
    };
}

async function getReportLogs(accountId, options = {}) {
    const pool = getPool();
    if (!pool) {
        return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 };
    }
    const opts = (options && typeof options === 'object') ? options : { pageSize: options };
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(opts.pageSize !== undefined ? opts.pageSize : opts.limit, 10) || 10));
    const page = Math.max(1, Number.parseInt(opts.page, 10) || 1);
    const offset = (page - 1) * pageSize;
    const { whereSql, params, filters } = buildReportLogWhereClause(accountId, opts);
    const [[countRow]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM report_logs ${whereSql}`,
        params,
    );
    const total = Math.max(0, Number(countRow && countRow.total) || 0);
    const [rows] = await pool.execute(
        `SELECT id, account_id, account_name, mode, ok, channel, title, content, error_message, created_at
         FROM report_logs
         ${whereSql}
         ORDER BY id ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
    );
    return {
        items: mapReportLogRows(rows),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
}

async function getReportLogStats(accountId, options = {}) {
    const pool = getPool();
    if (!pool) {
        return createEmptyReportLogStats();
    }
    const { whereSql, params } = buildReportLogWhereClause(accountId, options);
    const [[row]] = await pool.execute(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS successCount,
            SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failedCount,
            SUM(CASE WHEN mode = 'test' THEN 1 ELSE 0 END) AS testCount,
            SUM(CASE WHEN mode = 'hourly' THEN 1 ELSE 0 END) AS hourlyCount,
            SUM(CASE WHEN mode = 'daily' THEN 1 ELSE 0 END) AS dailyCount
         FROM report_logs
         ${whereSql}`,
        params,
    );
    return {
        total: Number(row && row.total) || 0,
        successCount: Number(row && row.successCount) || 0,
        failedCount: Number(row && row.failedCount) || 0,
        testCount: Number(row && row.testCount) || 0,
        hourlyCount: Number(row && row.hourlyCount) || 0,
        dailyCount: Number(row && row.dailyCount) || 0,
    };
}

async function exportReportLogs(accountId, options = {}) {
    const pool = getPool();
    if (!pool) {
        return { items: [], total: 0, maxRows: 1000, truncated: false };
    }
    const opts = (options && typeof options === 'object') ? options : {};
    const maxRows = Math.max(1, Math.min(2000, Number.parseInt(opts.maxRows, 10) || 1000));
    const { whereSql, params, filters } = buildReportLogWhereClause(accountId, opts);
    const [[countRow]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM report_logs ${whereSql}`,
        params,
    );
    const total = Math.max(0, Number(countRow && countRow.total) || 0);
    const [rows] = await pool.execute(
        `SELECT id, account_id, account_name, mode, ok, channel, title, content, error_message, created_at
         FROM report_logs
         ${whereSql}
         ORDER BY id ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ${maxRows}`,
        params,
    );
    return {
        items: mapReportLogRows(rows),
        total,
        maxRows,
        truncated: total > rows.length,
    };
}

async function deleteReportLogsByIds(accountId, ids = []) {
    const pool = getPool();
    if (!pool) return { ok: false, affectedRows: 0, requestedIds: 0 };
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedIds = Array.from(new Set(
        (Array.isArray(ids) ? ids : [ids])
            .map(id => Number.parseInt(id, 10))
            .filter(id => Number.isFinite(id) && id > 0),
    ));
    if (!normalizedAccountId || normalizedIds.length === 0) {
        return { ok: false, affectedRows: 0, requestedIds: 0 };
    }
    const placeholders = normalizedIds.map(() => '?').join(', ');
    const [result] = await pool.execute(
        `DELETE FROM report_logs
         WHERE account_id = ?
           AND id IN (${placeholders})`,
        [normalizedAccountId, ...normalizedIds],
    );
    return {
        ok: true,
        affectedRows: Number(result && result.affectedRows) || 0,
        requestedIds: normalizedIds.length,
    };
}

async function clearReportLogs(accountId) {
    const pool = getPool();
    if (!pool) return { ok: false, affectedRows: 0 };
    const [result] = await pool.execute(
        'DELETE FROM report_logs WHERE account_id = ?',
        [String(accountId || '').trim()],
    );
    return {
        ok: true,
        affectedRows: Number(result && result.affectedRows) || 0,
    };
}

async function pruneReportLogs(accountId, options = {}) {
    const pool = getPool();
    if (!pool) return { ok: false, affectedRows: 0 };
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) return { ok: false, affectedRows: 0 };
    const opts = (options && typeof options === 'object') ? options : { retentionDays: options };
    const parsedRetentionDays = Number.parseInt(opts.retentionDays, 10);
    const retentionDays = Math.max(0, Math.min(365, Number.isFinite(parsedRetentionDays) ? parsedRetentionDays : 30));
    if (retentionDays <= 0) {
        return { ok: true, affectedRows: 0, retentionDays };
    }
    const [result] = await pool.execute(
        `DELETE FROM report_logs
         WHERE account_id = ?
           AND created_at < DATE_SUB(NOW(), INTERVAL ${retentionDays} DAY)`,
        [normalizedAccountId],
    );
    return {
        ok: true,
        affectedRows: Number(result && result.affectedRows) || 0,
        retentionDays,
    };
}

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    transaction,
    bufferedInsertLog,
    updateFriendsCache,
    getCachedFriends,
    isRedisCacheAvailable,
    getAnnouncements,
    saveAnnouncement,
    deleteAnnouncement,
    invalidateAnnouncementCache,
    insertReportLog,
    getReportLogs,
    getReportLogStats,
    exportReportLogs,
    deleteReportLogsByIds,
    clearReportLogs,
    pruneReportLogs,
};

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { ensureLogDir } = require('../config/runtime-paths');

let winston = null;
try {
    // 可选依赖：未安装时回退到 console，避免运行中断

    winston = require('winston');
} catch {
    winston = null;
}

const SENSITIVE_KEY_RE = /code|token|password|passwd|auth|ticket|cookie|session/i;

function redactString(input) {
    let text = String(input || '');
    text = text.replace(/([?&](?:code|token|ticket|password)=)[^&\s]+/gi, '$1[REDACTED]');
    text = text.replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]');
    return text;
}

function sanitizeMeta(value, depth = 0) {
    if (depth > 4) return '[Truncated]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => sanitizeMeta(v, depth + 1));

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(String(k))) {
            out[k] = '[REDACTED]';
        } else {
            out[k] = sanitizeMeta(v, depth + 1);
        }
    }
    return out;
}

let fallbackLogDir = null;

function ensureFallbackLogDir() {
    if (fallbackLogDir) return fallbackLogDir;
    fallbackLogDir = ensureLogDir();
    return fallbackLogDir;
}

function appendFallbackLog(level, moduleName, message, meta) {
    try {
        const dir = ensureFallbackLogDir();
        const payload = {
            ts: new Date().toISOString(),
            level,
            module: moduleName,
            message: redactString(message),
            meta: sanitizeMeta(meta || {}),
        };
        const line = `${JSON.stringify(payload)}\n`;
        fs.appendFileSync(path.join(dir, 'combined.log'), line, 'utf8');
        if (level === 'error') {
            fs.appendFileSync(path.join(dir, 'error.log'), line, 'utf8');
        }
    } catch {
        // ignore file write errors in fallback mode
    }
}

function createConsoleFallback(moduleName) {
    const write = (level, message, meta) => {
        const ts = new Date().toISOString();
        const safeMsg = redactString(message);
        const safeMeta = sanitizeMeta(meta);
        appendFallbackLog(level, moduleName, safeMsg, safeMeta);
        if (safeMeta && Object.keys(safeMeta).length > 0) {
            console.warn(`[${ts}] [${level}] [${moduleName}] ${safeMsg} ${JSON.stringify(safeMeta)}`);
        } else {
            console.warn(`[${ts}] [${level}] [${moduleName}] ${safeMsg}`);
        }
    };
    return {
        info: (message, meta) => write('info', message, meta),
        warn: (message, meta) => write('warn', message, meta),
        error: (message, meta) => write('error', message, meta),
        debug: (message, meta) => write('debug', message, meta),
    };
}

let rootLogger = null;

function getRootLogger() {
    if (rootLogger) return rootLogger;

    if (!winston) {
        rootLogger = null;
        return rootLogger;
    }

    const logDir = ensureLogDir();

    const level = String(process.env.LOG_LEVEL || 'info').toLowerCase();
    const { combine, timestamp, errors, json, colorize, printf } = winston.format;

    rootLogger = winston.createLogger({
        level,
        defaultMeta: { app: 'qq-farm-bot' },
        transports: [
            new winston.transports.Console({
                format: combine(
                    colorize(),
                    timestamp(),
                    errors({ stack: true }),
                    printf((info) => {
                        const moduleName = info.module ? `[${info.module}] ` : '';
                        const msg = redactString(info.message || '');
                        const meta = { ...info };
                        delete meta.level;
                        delete meta.message;
                        delete meta.timestamp;
                        delete meta.app;
                        delete meta.module;
                        const safeMeta = sanitizeMeta(meta);
                        const hasMeta = safeMeta && Object.keys(safeMeta).length > 0;
                        return `${info.timestamp} [${info.level}] ${moduleName}${msg}${hasMeta ? ` ${JSON.stringify(safeMeta)}` : ''}`;
                    }),
                ),
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'combined.log'),
                format: combine(timestamp(), errors({ stack: true }), json()),
                maxsize: 50 * 1024 * 1024, // 单文件最大 50MB
                maxFiles: 6,               // 最多保留 6 份归档
                tailable: true,            // 启用尾部滚动（日志永远写在 combined.log）
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'error.log'),
                level: 'error',
                format: combine(timestamp(), errors({ stack: true }), json()),
                maxsize: 50 * 1024 * 1024, // 错误日志也限制为 50MB
                maxFiles: 6,               // 保留 6 份
                tailable: true,
            }),
        ],
    });

    return rootLogger;
}

function createModuleLogger(moduleName = 'app') {
    const moduleTag = String(moduleName || 'app');
    const root = getRootLogger();
    if (!root) return createConsoleFallback(moduleTag);

    const child = root.child({ module: moduleTag });
    return {
        info(message, meta = {}) {
            child.info(redactString(message), sanitizeMeta(meta));
        },
        warn(message, meta = {}) {
            child.warn(redactString(message), sanitizeMeta(meta));
        },
        error(message, meta = {}) {
            child.error(redactString(message), sanitizeMeta(meta));
        },
        debug(message, meta = {}) {
            child.debug(redactString(message), sanitizeMeta(meta));
        },
    };
}

module.exports = {
    createModuleLogger,
    sanitizeMeta,
    redactString,
};

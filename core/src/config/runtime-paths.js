const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const isPackaged = !!process.pkg;

function getResourceRoot() {
    return path.join(__dirname, '..');
}

function getResourcePath(...segments) {
    return path.join(getResourceRoot(), ...segments);
}

function getProjectRootForWritable() {
    return isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '../../..');
}

function getAppRootForWritable() {
    return isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '../..');
}

function getDataDir() {
    return path.join(getAppRootForWritable(), 'data');
}

function ensureDataDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getDataFile(filename) {
    return path.join(getDataDir(), filename);
}

function getLogDir() {
    return path.join(getProjectRootForWritable(), 'logs');
}

function ensureLogDir() {
    const dir = getLogDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getLogFile(filename) {
    return path.join(getLogDir(), filename);
}

function getShareFilePath() {
    return path.join(getAppRootForWritable(), 'share.txt');
}

module.exports = {
    isPackaged,
    getResourcePath,
    getDataDir,
    getDataFile,
    ensureDataDir,
    getLogDir,
    ensureLogDir,
    getLogFile,
    getShareFilePath,
};

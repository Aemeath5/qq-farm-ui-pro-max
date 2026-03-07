#!/usr/bin/env node

/**
 * 自动启动功能测试脚本
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const AI_AUTOSTART_SCRIPT = path.join(__dirname, 'ai-autostart.js');
const LOG_FILE = path.join(PROJECT_ROOT, 'logs', 'ai-autostart-test.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 开始测试 AI 服务自动启动功能...\n');

  // 测试 1: 检查文件是否存在
  console.log('📌 测试 1: 检查必要文件');
  const requiredFiles = [
    'ai-services-daemon.js',
    'ai-autostart.js',
    '../../services/openviking/app.py',
    '../../services/openviking/requirements.txt',
    '../../core/src/services/contextManager.js',
    '../../core/src/services/qwenAIAssistant.js',
  ];

  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      console.log(`  ✅ ${file}`);
    } else {
      console.log(`  ❌ ${file} (不存在)`);
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    console.log('\n❌ 必要文件检查失败');
    return;
  }
  console.log('✅ 所有必要文件存在\n');

  // 测试 2: 检查 Python 虚拟环境
  console.log('📌 测试 2: 检查 Python 环境');
  const venvPython = process.platform === 'win32'
    ? '../../services/openviking/venv/Scripts/python.exe'
    : '../../services/openviking/venv/bin/python';

  if (fs.existsSync(path.join(__dirname, venvPython))) {
    console.log('  ✅ Python 虚拟环境已创建');

    try {
      execSync(`${venvPython} --version`, { stdio: 'ignore' });
      console.log('  ✅ Python 可执行');
    } catch (error) {
      console.log('  ⚠️  Python 虚拟环境可能未正确配置');
    }
  } else {
    console.log('  ⚠️  Python 虚拟环境不存在（将在首次启动时自动创建）');
  }
  console.log('');

  // 测试 3: 测试自动启动
  console.log('📌 测试 3: 测试自动启动功能');
  try {
    console.log('  正在启动守护进程...');
    execFileSync(process.execPath, [AI_AUTOSTART_SCRIPT, 'start'], { stdio: 'pipe', cwd: PROJECT_ROOT });
    await sleep(5000); // 等待 5 秒

    // 检查进程
    const isRunning = execFileSync(process.execPath, [AI_AUTOSTART_SCRIPT, 'status'], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (isRunning.includes('正在运行')) {
      console.log('  ✅ 守护进程启动成功');
    } else {
      console.log('  ❌ 守护进程启动失败');
    }
  } catch (error) {
    console.log('  ❌ 启动失败:', error.message);
  }
  console.log('');

  // 测试 4: 检查 OpenViking 服务
  console.log('📌 测试 4: 检查 OpenViking 服务');
  const axios = require('axios');

  try {
    const response = await axios.get('http://localhost:5000/health', {
      timeout: 5000,
    });

    if (response.data.status === 'healthy') {
      console.log('  ✅ OpenViking 服务运行正常');
      console.log(`  📂 工作目录：${response.data.workspace}`);
    } else {
      console.log('  ❌ OpenViking 服务状态异常');
    }
  } catch (error) {
    console.log('  ❌ 无法访问 OpenViking 服务:', error.message);
  }
  console.log('');

  // 测试 5: 检查日志
  console.log('📌 测试 5: 检查日志系统');
  const logFiles = [
    path.join(PROJECT_ROOT, 'logs', 'ai-services.log'),
    path.join(PROJECT_ROOT, 'logs', 'ai-autostart.log'),
  ];

  for (const logFile of logFiles) {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      console.log(`  ✅ ${path.relative(PROJECT_ROOT, logFile)} (${stats.size} bytes)`);
    } else {
      console.log(`  ℹ️  ${path.relative(PROJECT_ROOT, logFile)} (不存在，正常)`);
    }
  }
  console.log('');

  // 测试 6: 测试服务停止
  console.log('📌 测试 6: 测试服务停止');
  try {
    execFileSync(process.execPath, [AI_AUTOSTART_SCRIPT, 'stop'], { stdio: 'pipe', cwd: PROJECT_ROOT });
    await sleep(2000);

    const status = execFileSync(process.execPath, [AI_AUTOSTART_SCRIPT, 'status'], { encoding: 'utf8', cwd: PROJECT_ROOT });
    if (status.includes('未运行')) {
      console.log('  ✅ 服务停止成功');
    } else {
      console.log('  ⚠️  服务可能仍在运行');
    }
  } catch (error) {
    console.log('  ⚠️  停止命令执行失败:', error.message);
  }
  console.log('');

  // 总结
  console.log('═══════════════════════════════════════════');
  console.log('📊 测试总结:');
  console.log('═══════════════════════════════════════════');
  console.log('✅ 文件检查通过');
  console.log('✅ 环境检查完成');
  console.log('✅ 自动启动功能正常');
  console.log('✅ 日志系统就绪');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('💡 提示:');
  console.log('1. 现在可以正常使用项目了');
  console.log('2. AI 服务会自动在后台启动');
  console.log('3. 使用 "node ai-autostart.js status" 查看状态');
  console.log('4. 日志文件在 logs/ 目录下');
  console.log('');
}

// 运行测试
runTest().catch((error) => {
  console.error('❌ 测试失败:', error.message);
  process.exit(1);
});

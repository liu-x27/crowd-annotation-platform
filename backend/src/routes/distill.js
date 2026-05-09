import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { authRequired, adminOnly } from '../middleware/auth.js';
import Annotation from '../models/Annotation.js';
import Sample from '../models/Sample.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 并发锁：记录正在训练的 taskId，防止同一任务同时触发多次
const runningDistillations = new Set();

// 触发蒸馏训练
router.post('/tasks/:taskId/distill', authRequired, adminOnly, async (req, res) => {
  const { taskId } = req.params;

  try {
    const mongoose = (await import('mongoose')).default;
    let taskObjId;
    try {
      taskObjId = new mongoose.Types.ObjectId(taskId);
    } catch (e) {
      return res.status(400).json({ ok: false, error: '无效的任务 ID' });
    }

    // 并发锁检查：同一任务不允许同时运行两次蒸馏
    if (runningDistillations.has(taskId)) {
      return res.status(409).json({ ok: false, error: '该任务正在训练中，请等待当前训练完成后再试' });
    }

    const Task = (await import('../models/Task.js')).default;
    const task = await Task.findById(taskObjId);
    if (!task) {
      return res.status(404).json({ ok: false, error: '任务不存在' });
    }

    const isNerTask = task.type === 'ner';

    // 只统计已审核通过（或旧数据 status 为 null）的标注
    const approvedFilter = { taskId: taskObjId, $or: [{ status: 'approved' }, { status: null }] };
    const totalAnns  = await Annotation.countDocuments(approvedFilter);
    const llmAnns    = await Annotation.countDocuments({ ...approvedFilter, fromLLM: true });
    const humanAnns  = totalAnns - llmAnns;

    if (totalAnns === 0) {
      return res.status(400).json({
        ok: false,
        error: '没有已审核通过的标注数据。请先对 LLM 预标注进行审核，或进行人工标注。',
        totalAnnotations: 0,
        totalSamples: await Sample.countDocuments({ taskId: taskObjId })
      });
    }

    const { mode = 'simple', temperature, maxFeatures } = req.body;

    // NER 任务使用专用脚本；分类任务按 mode 选择
    let scriptName;
    if (isNerTask) {
      scriptName = 'train_distill_ner.py';
    } else if (mode === 'advanced') {
      scriptName = 'train_distill_advanced.py';
    } else if (mode === 'advanced_lite') {
      scriptName = 'train_distill_advanced_lite.py';
    } else {
      scriptName = 'train_distill.py';
    }

    const distillScript = path.resolve(__dirname, `../../../distill/${scriptName}`);
    const distillDir = path.resolve(__dirname, '../../../distill');

    if (!fs.existsSync(distillScript)) {
      return res.status(500).json({
        ok: false,
        error: `蒸馏脚本不存在: ${distillScript}`,
        hint: isNerTask ? '请检查 train_distill_ner.py 文件是否存在' :
              mode === 'advanced' ? '请使用 advanced_lite 模式（不依赖 scipy/scikit-learn）' :
              mode === 'advanced_lite' ? '请检查 train_distill_advanced_lite.py 文件是否存在' :
              '请检查 train_distill.py 文件是否存在'
      });
    }

    const venvPython = path.resolve(distillDir, '.venv/Scripts/python.exe');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';

    console.log(`[蒸馏] 使用 Python: ${pythonCmd}`);
    if (!fs.existsSync(venvPython)) {
      console.log('[蒸馏] 警告: 虚拟环境 Python 不存在，将使用系统 Python');
    }

    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/';

    // NER 脚本只需 taskId 参数；分类脚本支持 temperature/maxFeatures
    const scriptArgs = [distillScript, taskId];
    if (!isNerTask && (mode === 'advanced' || mode === 'advanced_lite')) {
      if (temperature) scriptArgs.push(temperature.toString());
      if (maxFeatures) scriptArgs.push(maxFeatures.toString());
    }

    const modeText = isNerTask ? 'NER实体词典' :
                     mode === 'advanced' ? '高级' :
                     mode === 'advanced_lite' ? '高级（轻量）' : '简单';
    console.log(`[蒸馏] 开始训练任务 ${taskId}，模式: ${modeText}，标注数据：${totalAnns} 条`);

    // 加锁
    runningDistillations.add(taskId);

    const py = spawn(pythonCmd, scriptArgs, {
      stdio: 'pipe',
      cwd: distillDir,
      env: { ...process.env, MONGO_URI: mongoUri }
    });

    let stdout = '';
    let stderr = '';
    // 防止 py.on('error') 和 py.on('close') 都发送响应
    let responseSent = false;

    py.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log(`[蒸馏] ${text.trim()}`);
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[蒸馏错误] ${text.trim()}`);
    });

    py.on('close', async (code) => {
      if (responseSent) return;
      responseSent = true;
      runningDistillations.delete(taskId);

      console.log(`[蒸馏] Python 进程退出，代码: ${code}`);

      if (code === 0) {
        let modelFileName;
        if (isNerTask) {
          modelFileName = `distilled_ner_${taskId}.json`;
        } else if (mode === 'advanced') {
          modelFileName = `distilled_advanced_${taskId}.joblib`;
        } else if (mode === 'advanced_lite') {
          modelFileName = `distilled_advanced_lite_${taskId}.joblib`;
        } else {
          modelFileName = `distilled_${taskId}.joblib`;
        }

        const modelPath = path.resolve(distillDir, `models/${modelFileName}`);
        const modelExists = fs.existsSync(modelPath);

        if (!modelExists) {
          return res.status(500).json({
            ok: false,
            error: `训练完成但模型文件未找到: ${modelFileName}`,
            stdout,
            stderr
          });
        }

        // NER：读取 metrics JSON
        let nerMetrics = null;
        if (isNerTask) {
          try {
            const nerMetricsPath = path.resolve(distillDir, `models/metrics_ner_${taskId}.json`);
            if (fs.existsSync(nerMetricsPath)) {
              nerMetrics = JSON.parse(fs.readFileSync(nerMetricsPath, 'utf8'));
            }
          } catch (e) {
            console.log('[蒸馏] NER 指标读取失败:', e.message);
          }
        }

        // 分类模式：从 stdout 解析指标（高级模式）
        let modelMetrics = null;
        if (!isNerTask && (mode === 'advanced' || mode === 'advanced_lite')) {
          try {
            const trainMatch = stdout.match(/训练集准确率:\s*([\d.]+)/);
            const testMatch = stdout.match(/测试集准确率:\s*([\d.]+)/);
            const trainMatch2 = stdout.match(/训练集:\s*(\d+)\s*条/);
            const testMatch2 = stdout.match(/测试集:\s*(\d+)\s*条/);
            const featuresMatch = stdout.match(/特征维度:\s*\([\d, ]+\)/);

            if (trainMatch || testMatch) {
              modelMetrics = {};
              if (trainMatch) modelMetrics.train_accuracy = parseFloat(trainMatch[1]);
              if (testMatch) modelMetrics.test_accuracy = parseFloat(testMatch[1]);
              if (trainMatch2) modelMetrics.n_train = parseInt(trainMatch2[1]);
              if (testMatch2) modelMetrics.n_test = parseInt(testMatch2[1]);
              if (featuresMatch) {
                const dims = featuresMatch[0].match(/\d+/g);
                if (dims && dims.length >= 2) modelMetrics.n_features = parseInt(dims[1]);
              }
            }
          } catch (e) {
            console.log('[蒸馏] 从输出解析指标失败:', e.message);
          }
        }

        const modeLabelText = isNerTask ? 'NER实体词典模式' :
                              mode === 'advanced' ? '高级模式' :
                              mode === 'advanced_lite' ? '高级模式（轻量）' : '简单模式';
        res.json({
          ok: true,
          message: `蒸馏训练完成（${modeLabelText}）`,
          mode: isNerTask ? 'ner' : mode,
          metrics: {
            totalAnnotations: totalAnns,
            llmAnnotations: llmAnns,
            humanAnnotations: humanAnns,
            modelSaved: modelExists,
            ...(nerMetrics ? { nerMetrics } : {}),
            ...(modelMetrics && Object.keys(modelMetrics).length > 0 ? { advancedMetrics: modelMetrics } : {})
          },
          stdout
        });
      } else {
        res.status(500).json({
          ok: false,
          error: '蒸馏训练失败',
          details: stderr || stdout || '未知错误',
          stdout,
          stderr
        });
      }
    });

    py.on('error', (err) => {
      if (responseSent) return;
      responseSent = true;
      runningDistillations.delete(taskId);
      console.error('[蒸馏] 进程启动失败:', err);
      res.status(500).json({
        ok: false,
        error: `无法启动 Python 进程: ${err.message}`,
        hint: '请确保已安装 Python 并配置好虚拟环境'
      });
    });
  } catch (err) {
    runningDistillations.delete(taskId);
    console.error('[蒸馏] 错误:', err);
    res.status(500).json({ ok: false, error: err.message || '未知错误' });
  }
});

// 获取蒸馏训练指标
router.get('/tasks/:taskId/metrics', authRequired, async (req, res) => {
  const { taskId } = req.params;

  try {
    const mongoose = (await import('mongoose')).default;
    let taskObjId;
    try {
      taskObjId = new mongoose.Types.ObjectId(taskId);
    } catch (e) {
      return res.status(400).json({ error: '无效的任务 ID' });
    }

    const totalAnns = await Annotation.countDocuments({ taskId: taskObjId });
    const llmAnns = await Annotation.countDocuments({ taskId: taskObjId, fromLLM: true });
    const humanAnns = totalAnns - llmAnns;

    // 判断任务类型，NER 任务用 span label 统计，分类任务用 label 字段统计
    const TaskModel = (await import('../models/Task.js')).default;
    const taskForMetrics = await TaskModel.findById(taskObjId).lean();
    const isNerTask = taskForMetrics?.type === 'ner';

    const labelStats = isNerTask
      ? await Annotation.aggregate([
          { $match: { taskId: taskObjId } },
          { $unwind: { path: '$spans', preserveNullAndEmptyArrays: false } },
          { $group: { _id: '$spans.label', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ])
      : await Annotation.aggregate([
          { $match: { taskId: taskObjId, label: { $ne: null } } },
          { $group: { _id: '$label', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]);

    const distillDir = path.resolve(__dirname, '../../../distill');
    const simpleModelPath       = path.resolve(distillDir, `models/distilled_${taskId}.joblib`);
    const advancedModelPath     = path.resolve(distillDir, `models/distilled_advanced_${taskId}.joblib`);
    const advancedLiteModelPath = path.resolve(distillDir, `models/distilled_advanced_lite_${taskId}.joblib`);
    const nerModelPath          = path.resolve(distillDir, `models/distilled_ner_${taskId}.json`);

    const simpleModelExists       = fs.existsSync(simpleModelPath);
    const advancedModelExists     = fs.existsSync(advancedModelPath);
    const advancedLiteModelExists = fs.existsSync(advancedLiteModelPath);
    const nerModelExists          = fs.existsSync(nerModelPath);

    // 从 JSON 文件读取指标（避免 spawnSync 阻塞事件循环）
    let advancedMetrics = null;
    let nerMetrics = null;

    // NER 指标
    if (nerModelExists) {
      const nerMetricsPath = path.resolve(distillDir, `models/metrics_ner_${taskId}.json`);
      if (fs.existsSync(nerMetricsPath)) {
        try {
          nerMetrics = JSON.parse(fs.readFileSync(nerMetricsPath, 'utf8'));
          console.log('[蒸馏指标] NER 指标读取成功');
        } catch (e) {
          console.log('[蒸馏指标] NER 指标读取失败:', e.message);
        }
      }
    }

    // 分类模型指标
    if (advancedLiteModelExists) {
      const metricsJsonPath = path.resolve(distillDir, `models/metrics_advanced_lite_${taskId}.json`);
      if (fs.existsSync(metricsJsonPath)) {
        try {
          advancedMetrics = JSON.parse(fs.readFileSync(metricsJsonPath, 'utf8'));
          console.log('[蒸馏指标] 从 JSON 文件读取指标成功（轻量级）');
        } catch (e) {
          console.log('[蒸馏指标] 读取 JSON 指标失败:', e.message);
        }
      }
    }

    if (!advancedMetrics && advancedModelExists) {
      const metricsJsonPath = path.resolve(distillDir, `models/metrics_advanced_${taskId}.json`);
      if (fs.existsSync(metricsJsonPath)) {
        try {
          advancedMetrics = JSON.parse(fs.readFileSync(metricsJsonPath, 'utf8'));
          console.log('[蒸馏指标] 从 JSON 文件读取指标成功（完整版）');
        } catch (e) {
          console.log('[蒸馏指标] 读取 JSON 指标失败:', e.message);
        }
      }
    }

    res.json({
      totalAnnotations: totalAnns,
      llmAnnotations: llmAnns,
      humanAnnotations: humanAnns,
      labelDistribution: labelStats,
      isNerTask,
      simpleModelExists,
      advancedModelExists,
      advancedLiteModelExists,
      nerModelExists,
      advancedMetrics,
      nerMetrics,
      // 是否有任务正在训练中
      isTraining: runningDistillations.has(taskId)
    });
  } catch (err) {
    console.error('[蒸馏指标] 错误:', err);
    res.status(500).json({ error: err.message || '获取指标失败' });
  }
});

// 在线推理（用已训练的蒸馏模型预测新文本）
router.post('/tasks/:taskId/predict', authRequired, async (req, res) => {
  const { taskId } = req.params;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: '请输入待预测文本' });
  }

  try {
    const mongoose = (await import('mongoose')).default;
    let taskObjId;
    try { taskObjId = new mongoose.Types.ObjectId(taskId); }
    catch { return res.status(400).json({ error: '无效的任务 ID' }); }

    const TaskModel = (await import('../models/Task.js')).default;
    const task = await TaskModel.findById(taskObjId).lean();
    if (!task) return res.status(404).json({ error: '任务不存在' });

    const modeHint = task.type === 'ner' ? 'ner' : 'classification';
    const distillDir = path.resolve(__dirname, '../../../distill');
    const predictScript = path.resolve(distillDir, 'predict_distill.py');

    if (!fs.existsSync(predictScript)) {
      return res.status(500).json({ error: 'predict_distill.py 脚本不存在' });
    }

    const venvPython = path.resolve(distillDir, '.venv/Scripts/python.exe');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/';

    const { spawnSync } = await import('child_process');
    const result = spawnSync(
      pythonCmd,
      [predictScript, taskId, text.trim(), modeHint],
      { cwd: distillDir, encoding: 'utf8', timeout: 15000, env: { ...process.env, MONGO_URI: mongoUri } }
    );

    if (result.status !== 0) {
      console.error('[推理] Python 错误:', result.stderr);
      return res.status(500).json({ error: '推理失败', details: result.stderr?.slice(0, 300) });
    }

    const stdout = result.stdout?.trim();
    if (!stdout) return res.status(500).json({ error: '推理无输出' });

    let prediction;
    try { prediction = JSON.parse(stdout); }
    catch { return res.status(500).json({ error: '推理结果解析失败', raw: stdout }); }

    if (prediction.error) return res.status(400).json({ error: prediction.error });

    res.json({ ok: true, ...prediction });
  } catch (err) {
    console.error('[推理] 错误:', err);
    res.status(500).json({ error: err.message || '推理失败' });
  }
});

export default router;

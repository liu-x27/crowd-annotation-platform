import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import Task from '../models/Task.js';
import Sample from '../models/Sample.js';
import Annotation from '../models/Annotation.js';
import User from '../models/User.js';
import { authRequired, adminOnly } from '../middleware/auth.js';

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// 自动为单个样本生成 LLM 建议（供 next-sample 时按需触发）
async function autoLabelSample(task, sample) {
  const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const modelName  = process.env.OLLAMA_MODEL    || 'qwen3:0.6b';
  try {
    if (task.type === 'ner') {
      const prompt = `你是一个命名实体识别助手。请从以下文本中识别所有命名实体，以JSON数组格式输出，每项包含：
- "text"：实体原文（必须与文本中完全一致）
- "label"：实体类型（只能是以下之一：${task.labels.join('、')}）

只输出JSON数组，不要有任何其他内容，不要解释。
示例格式：[{"text":"张伟","label":"PER"},{"text":"北京","label":"LOC"}]

文本：${sample.content}`;

      const resp = await axios.post(
        `${ollamaBase}/api/chat`,
        { model: modelName, messages: [{ role: 'user', content: prompt }], stream: false },
        { timeout: 20000 }
      );

      const raw = (resp.data?.message?.content || '').trim();
      let validatedSpans = [];
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        let searchFrom = 0;
        for (const item of parsed) {
          if (!item.text || !task.labels.includes(item.label)) continue;
          const idx = sample.content.indexOf(item.text, searchFrom);
          if (idx !== -1) {
            validatedSpans.push({ start: idx, end: idx + item.text.length, label: item.label, text: item.text });
            searchFrom = idx + item.text.length;
          } else {
            const idx2 = sample.content.indexOf(item.text);
            if (idx2 !== -1 && !validatedSpans.some(sp => sp.start <= idx2 && idx2 < sp.end)) {
              validatedSpans.push({ start: idx2, end: idx2 + item.text.length, label: item.label, text: item.text });
            }
          }
        }
      }

      return await Annotation.findOneAndUpdate(
        { taskId: task._id, sampleId: sample._id, fromLLM: true },
        { $setOnInsert: { userId: null, label: null, spans: validatedSpans, confidence: 0.9, status: 'pending' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();

    } else {
      const prompt = `你是一个文本分类助手。请从下列标签中选出一个最合适的：${task.labels.join(' / ')}。请只输出标签本身。\n\n文本：\n${sample.content}`;

      const resp = await axios.post(
        `${ollamaBase}/api/chat`,
        { model: modelName, messages: [{ role: 'user', content: prompt }], stream: false },
        { timeout: 20000 }
      );

      const raw = (resp.data?.message?.content || '').trim();
      const found = task.labels.find((l) => raw.includes(l));
      const predicted = found || task.labels[0];

      return await Annotation.findOneAndUpdate(
        { taskId: task._id, sampleId: sample._id, fromLLM: true },
        { $setOnInsert: { userId: null, label: predicted, spans: [], confidence: 0.9, status: 'pending' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    }
  } catch (err) {
    console.error('[自动预标注失败]', sample._id, err.message);
    return null;
  }
}

// 列出任务
// - 管理员：返回所有任务（附 sampleCount）
// - 标注员：基于样本分配决定可见性
//   有个人分配样本的任务 → 可见（hasPersonalAssignment=true）
//   无任何分配的公开任务 → 可见（hasPersonalAssignment=false）
//   仅分配给他人的任务  → 不可见
router.get('/', authRequired, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let tasks;

    if (isAdmin) {
      tasks = await Task.find().sort({ createdAt: -1 }).lean();
    } else {
      const userId = new mongoose.Types.ObjectId(req.user.id);

      // 该用户有分配样本的任务 ID
      const personalTaskIds = await Sample.distinct('taskId', { assignedTo: userId });
      // 所有有任何样本分配的任务 ID（受限任务）
      const restrictedTaskIds = await Sample.distinct('taskId', {
        assignedTo: { $ne: null, $exists: true },
      });

      const allTasks = await Task.find().sort({ createdAt: -1 }).lean();
      const personalSet  = new Set(personalTaskIds.map(id => id.toString()));
      const restrictedSet = new Set(restrictedTaskIds.map(id => id.toString()));

      tasks = allTasks
        .filter(t => personalSet.has(t._id.toString()) || !restrictedSet.has(t._id.toString()))
        .map(t => ({
          ...t,
          hasPersonalAssignment: personalSet.has(t._id.toString()),
        }));
    }

    // 为每个任务附加样本总数
    const taskIds = tasks.map(t => t._id);
    if (taskIds.length > 0) {
      const sampleCounts = await Sample.aggregate([
        { $match: { taskId: { $in: taskIds } } },
        { $group: { _id: '$taskId', count: { $sum: 1 } } },
      ]);
      const scMap = {};
      for (const sc of sampleCounts) scMap[sc._id.toString()] = sc.count;
      tasks = tasks.map(t => ({ ...t, sampleCount: scMap[t._id.toString()] || 0 }));
    }

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取任务列表失败' });
  }
});

// 创建任务（管理员）
router.post('/', authRequired, adminOnly, async (req, res) => {
  try {
    const { name, description, type = 'text_classification', labels = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const task = await Task.create({
      name,
      description,
      type,
      labels,
      createdBy: req.user.id
    });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message || '创建任务失败' });
  }
});

// 为任务添加样本（简化：单条文本）
router.post('/:taskId/samples', authRequired, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const { content, meta } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const sample = await Sample.create({ taskId, content, meta });
    res.json(sample);
  } catch (err) {
    res.status(500).json({ error: err.message || '添加样本失败' });
  }
});

// 批量导入样本（CSV / TXT 文本，前端解析后以数组形式 POST）
router.post('/:taskId/samples/import', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });

    const { lines } = req.body; // string[]
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: '没有可导入的内容' });
    }

    const trimmed = lines.map((l) => String(l).trim()).filter(Boolean);
    if (trimmed.length === 0) return res.status(400).json({ error: '所有行均为空' });
    if (trimmed.length > 5000) return res.status(400).json({ error: '单次最多导入 5000 条' });

    const docs = trimmed.map((content) => ({ taskId, content }));
    await Sample.insertMany(docs, { ordered: false });
    res.json({ ok: true, imported: docs.length });
  } catch (err) {
    res.status(500).json({ error: err.message || '批量导入失败' });
  }
});

// 分页获取样本
router.get('/:taskId/samples', authRequired, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      Sample.find({ taskId }).skip(skip).limit(pageSize).sort({ createdAt: -1 }).lean(),
      Sample.countDocuments({ taskId })
    ]);

    res.json({ items, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message || '获取样本失败' });
  }
});

// 获取当前用户的下一个待标注样本
router.get('/:taskId/next-sample', authRequired, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const userId = req.user.id;

    const annotatedSampleIds = await Annotation.find({ taskId, userId }).distinct('sampleId');

    // 样本级别分配：
    //   若该用户在此任务有分配样本 → 只显示其分配样本
    //   若其他人有分配但该用户没有 → 只显示未分配样本
    //   若无任何分配 → 显示全部样本
    const userObjId = new mongoose.Types.ObjectId(userId);
    const userHasAssignments = await Sample.exists({ taskId, assignedTo: userObjId });

    let sampleFilter;
    if (userHasAssignments) {
      sampleFilter = {
        taskId,
        _id: { $nin: annotatedSampleIds },
        assignedTo: userObjId,
      };
    } else {
      const othersHaveAssignments = await Sample.exists({
        taskId,
        assignedTo: { $ne: null, $exists: true },
      });
      sampleFilter = {
        taskId,
        _id: { $nin: annotatedSampleIds },
        ...(othersHaveAssignments ? {
          $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
        } : {}),
      };
    }

    const sample = await Sample.findOne(sampleFilter).sort({ createdAt: 1, _id: 1 }).lean();

    if (!sample) return res.json({ sample: null, labels: [] });

    const task = await Task.findById(taskId).lean();

    // 查找已有 LLM 建议；若无则自动触发（按需单条预标注）
    let llmAnn = await Annotation.findOne({ taskId, sampleId: sample._id, fromLLM: true }).lean();
    if (!llmAnn && task?.labels?.length > 0) {
      llmAnn = await autoLabelSample(task, sample);
    }

    // 对 NER 任务，还返回当前用户已有的 span 标注（用于回显）
    const existingAnn = task?.type === 'ner'
      ? await Annotation.findOne({ taskId, sampleId: sample._id, fromLLM: false, userId }).lean()
      : null;

    res.json({
      sample: {
        ...sample,
        llmSuggestion: task?.type === 'ner' ? null : (llmAnn?.label || null),
        llmSpans:      task?.type === 'ner' ? (llmAnn?.spans  || []) : [],
        existingSpans: task?.type === 'ner' ? (existingAnn?.spans || []) : [],
      },
      labels:   task?.labels   || [],
      taskType: task?.type     || 'text_classification',
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '获取样本失败' });
  }
});

// 查看任务样本级别的分配概况（各标注员分到了多少条）
router.get('/:taskId/samples/assignments', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const taskObjId = new mongoose.Types.ObjectId(taskId);

    const [total, grouped] = await Promise.all([
      Sample.countDocuments({ taskId: taskObjId }),
      Sample.aggregate([
        { $match: { taskId: taskObjId, assignedTo: { $ne: null, $exists: true } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      ]),
    ]);

    const userIds = grouped.map((g) => g._id).filter(Boolean);
    const users   = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select('username').lean()
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u.username]));

    const assignments = grouped.map((g) => ({
      userId:   g._id,
      username: userMap[g._id?.toString()] || '未知用户',
      count:    g.count,
    }));

    const assignedCount = assignments.reduce((s, a) => s + a.count, 0);
    res.json({ total, assignments, unassigned: total - assignedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || '获取分配概况失败' });
  }
});

// 按范围分配样本给指定标注员（1-indexed，覆盖式：已有分配的也会被更新）
router.post('/:taskId/samples/assign-range', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });

    const { userId, from, to } = req.body;
    if (!isValidObjectId(userId)) return res.status(400).json({ error: '无效的用户 ID' });
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return res.status(400).json({ error: 'from / to 必须为正整数且 from ≤ to' });
    }

    const skip  = from - 1;
    const limit = to - from + 1;

    // 注意：.distinct() 会忽略 .skip()/.limit()，必须用 .select().lean()
    const rawSamples = await Sample.find({ taskId })
      .sort({ createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .select('_id')
      .lean();
    const sampleIds = rawSamples.map(s => s._id);

    if (sampleIds.length === 0) {
      return res.status(400).json({ error: '指定范围内没有样本' });
    }

    await Sample.updateMany(
      { _id: { $in: sampleIds } },
      { $set: { assignedTo: new mongoose.Types.ObjectId(userId) } }
    );

    res.json({ ok: true, assigned: sampleIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message || '样本分配失败' });
  }
});

// 清除任务所有样本的分配（恢复全员可见）
router.delete('/:taskId/samples/assignments', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const result = await Sample.updateMany({ taskId }, { $set: { assignedTo: null } });
    res.json({ ok: true, cleared: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || '清除分配失败' });
  }
});

// 获取任务统计（删除前确认用）
router.get('/:taskId/stats', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const taskObjId = new mongoose.Types.ObjectId(taskId);
    const [sampleCount, annotationCount] = await Promise.all([
      Sample.countDocuments({ taskId: taskObjId }),
      Annotation.countDocuments({ taskId: taskObjId }),
    ]);
    res.json({ sampleCount, annotationCount });
  } catch (err) {
    res.status(500).json({ error: err.message || '获取统计失败' });
  }
});

// 获取任务已分配标注员列表
router.get('/:taskId/assignees', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const task = await Task.findById(taskId).populate('assignees', '-passwordHash').lean();
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task.assignees || []);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取分配信息失败' });
  }
});

// 设置任务分配标注员（全量覆盖）
router.put('/:taskId/assignees', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const { userIds = [] } = req.body;
    const validIds = userIds.filter(isValidObjectId).map((id) => new mongoose.Types.ObjectId(id));
    const task = await Task.findByIdAndUpdate(
      taskId,
      { $set: { assignees: validIds } },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ ok: true, assignees: task.assignees });
  } catch (err) {
    res.status(500).json({ error: err.message || '更新分配失败' });
  }
});

// 删除任务（级联删除 samples + annotations）
router.delete('/:taskId', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const taskObjId = new mongoose.Types.ObjectId(taskId);

    const task = await Task.findById(taskObjId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    const [{ deletedCount: samplesDeleted }, { deletedCount: annotationsDeleted }] = await Promise.all([
      Sample.deleteMany({ taskId: taskObjId }),
      Annotation.deleteMany({ taskId: taskObjId }),
    ]);
    await Task.findByIdAndDelete(taskObjId);

    res.json({ ok: true, samplesDeleted, annotationsDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message || '删除任务失败' });
  }
});

export default router;

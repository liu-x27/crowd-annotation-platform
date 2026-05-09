import express from 'express';
import mongoose from 'mongoose';
import Annotation from '../models/Annotation.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import Sample from '../models/Sample.js';
import { authRequired, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// 获取所有用户（管理员）
router.get('/', authRequired, adminOnly, async (_req, res) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取用户列表失败' });
  }
});

// 获取标注员贡献统计（管理员）
// 返回字段包含：annotationCount, taskCount, assignedTaskCount, assignedSampleCount
router.get('/contributions', authRequired, adminOnly, async (_req, res) => {
  try {
    const users = await User.find().select('-passwordHash').lean();

    // 人工标注数量
    const contributions = await Annotation.aggregate([
      { $match: { fromLLM: false } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const contribMap = Object.fromEntries(
      contributions.map((c) => [c._id?.toString(), c.count])
    );

    // 参与任务数
    const taskContribs = await Annotation.aggregate([
      { $match: { fromLLM: false } },
      { $group: { _id: { userId: '$userId', taskId: '$taskId' } } },
      { $group: { _id: '$_id.userId', taskCount: { $sum: 1 } } },
    ]);
    const taskMap = Object.fromEntries(
      taskContribs.map((c) => [c._id?.toString(), c.taskCount])
    );

    // 样本分配统计
    const sampleAssignStats = await Sample.aggregate([
      { $match: { assignedTo: { $ne: null, $exists: true } } },
      {
        $group: {
          _id: '$assignedTo',
          sampleCount: { $sum: 1 },
          taskIds: { $addToSet: '$taskId' },
        },
      },
    ]);
    const assignMap = Object.fromEntries(
      sampleAssignStats.map((a) => [
        a._id?.toString(),
        { assignedSampleCount: a.sampleCount, assignedTaskCount: a.taskIds.length },
      ])
    );

    const result = users
      .map((u) => ({
        ...u,
        annotationCount:    contribMap[u._id?.toString()] || 0,
        taskCount:          taskMap[u._id?.toString()]    || 0,
        assignedTaskCount:  assignMap[u._id?.toString()]?.assignedTaskCount  || 0,
        assignedSampleCount: assignMap[u._id?.toString()]?.assignedSampleCount || 0,
      }))
      .sort((a, b) => b.annotationCount - a.annotationCount);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取贡献统计失败' });
  }
});

// 获取某用户的样本分配概况
// 返回：[{ taskId, taskName, taskType, assignedCount, totalCount }]
router.get('/:userId/assignments', authRequired, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: '无效的用户 ID' });
    }
    const userObjId = new mongoose.Types.ObjectId(userId);

    // 该用户有分配样本的任务及数量
    const groups = await Sample.aggregate([
      { $match: { assignedTo: userObjId } },
      { $group: { _id: '$taskId', count: { $sum: 1 } } },
    ]);

    const taskIds = groups.map((g) => g._id);
    const [tasks, totals] = await Promise.all([
      taskIds.length
        ? Task.find({ _id: { $in: taskIds } }).select('name type').lean()
        : [],
      taskIds.length
        ? Sample.aggregate([
            { $match: { taskId: { $in: taskIds } } },
            { $group: { _id: '$taskId', total: { $sum: 1 } } },
          ])
        : [],
    ]);

    const taskMap  = Object.fromEntries(tasks.map((t) => [t._id.toString(), t]));
    const totalMap = Object.fromEntries(totals.map((t) => [t._id.toString(), t.total]));

    const result = groups.map((g) => ({
      taskId:       g._id,
      taskName:     taskMap[g._id.toString()]?.name  || '未知任务',
      taskType:     taskMap[g._id.toString()]?.type  || '',
      assignedCount: g.count,
      totalCount:   totalMap[g._id.toString()]       || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取分配概况失败' });
  }
});

// 为某标注员设置样本分配（全量替换：先清除该用户所有样本分配，再写入新范围）
// Body: { assignments: [{ taskId, from, to }] }
router.put('/:userId/assignments', authRequired, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: '无效的用户 ID' });
    }
    const userObjId = new mongoose.Types.ObjectId(userId);
    const { assignments = [] } = req.body;

    // 1. 清除该用户所有旧分配
    await Sample.updateMany({ assignedTo: userObjId }, { $set: { assignedTo: null } });

    // 2. 按范围写入新分配
    for (const a of assignments) {
      if (!mongoose.Types.ObjectId.isValid(a.taskId)) continue;
      const from = Number(a.from);
      const to   = Number(a.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) continue;

      const skip  = from - 1;
      const limit = to - from + 1;

      const rawSamples = await Sample.find({ taskId: new mongoose.Types.ObjectId(a.taskId) })
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .select('_id')
        .lean();

      const sampleIds = rawSamples.map((s) => s._id);
      if (sampleIds.length > 0) {
        await Sample.updateMany(
          { _id: { $in: sampleIds } },
          { $set: { assignedTo: userObjId } }
        );
      }
    }

    res.json({ ok: true, assignmentCount: assignments.length });
  } catch (err) {
    res.status(500).json({ error: err.message || '更新分配失败' });
  }
});

export default router;

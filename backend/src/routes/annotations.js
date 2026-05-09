import express from 'express';
import mongoose from 'mongoose';
import Annotation from '../models/Annotation.js';
import Sample from '../models/Sample.js';
import Task from '../models/Task.js';
import { authRequired, adminOnly } from '../middleware/auth.js';

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// ── 提交标注（幂等：同一用户对同一样本重复提交则覆盖）──────────────────────
router.post('/', authRequired, async (req, res) => {
  try {
    const { taskId, sampleId, label, spans } = req.body;
    if (!taskId || !sampleId) {
      return res.status(400).json({ error: 'taskId and sampleId required' });
    }
    if (!isValidObjectId(taskId) || !isValidObjectId(sampleId)) {
      return res.status(400).json({ error: '无效的 taskId 或 sampleId' });
    }

    const task = await Task.findById(taskId).lean();
    if (!task) return res.status(404).json({ error: '任务不存在' });

    let updateFields;
    if (task.type === 'ner') {
      if (!Array.isArray(spans)) {
        return res.status(400).json({ error: 'NER 任务需要 spans 数组' });
      }
      updateFields = { spans, label: null, status: 'approved' };
    } else {
      if (!label) {
        return res.status(400).json({ error: '文本分类任务需要 label' });
      }
      updateFields = { label, spans: [], status: 'approved' };
    }

    const ann = await Annotation.findOneAndUpdate(
      { taskId, sampleId, userId: req.user.id, fromLLM: false },
      { $set: updateFields },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(ann);
  } catch (err) {
    res.status(500).json({ error: err.message || '提交标注失败' });
  }
});

// ── 查看某任务的全部标注 ────────────────────────────────────────────────────
router.get('/task/:taskId', authRequired, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const anns = await Annotation.find({ taskId }).sort({ createdAt: -1 }).lean();
    res.json(anns);
  } catch (err) {
    res.status(500).json({ error: err.message || '获取标注失败' });
  }
});

// ── 导出标注数据（CSV/JSON格式）────────────────────────────────────────────
router.get('/task/:taskId/export', authRequired, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const { format = 'json' } = req.query;

    const anns = await Annotation.find({ taskId }).lean();
    const sampleIds = [...new Set(anns.map((a) => a.sampleId.toString()))];
    const samples = await Sample.find({ _id: { $in: sampleIds } }).lean();
    const sampleMap = Object.fromEntries(samples.map((s) => [s._id.toString(), s]));

    const data = anns.map((a) => ({
      sampleId:  a.sampleId.toString(),
      content:   sampleMap[a.sampleId.toString()]?.content || '',
      label:     a.label || '',
      spans:     a.spans || [],
      fromLLM:   a.fromLLM,
      status:    a.status || 'approved',
      userId:    a.userId?.toString() || '',
      createdAt: a.createdAt,
    }));

    if (format === 'csv') {
      const csvHeader = '样本ID,文本内容,标签,实体Spans,来源,审核状态,标注员ID,创建时间\n';
      const csvRows = data.map((d) =>
        [
          d.sampleId,
          `"${(d.content || '').replace(/"/g, '""')}"`,
          d.label,
          `"${JSON.stringify(d.spans).replace(/"/g, '""')}"`,
          d.fromLLM ? 'LLM' : '人工',
          d.status,
          d.userId,
          d.createdAt ? new Date(d.createdAt).toISOString() : '',
        ].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="annotations_${taskId}.csv"`);
      res.send('\ufeff' + csvHeader + csvRows.join('\n'));
    } else {
      res.json({ taskId, count: data.length, data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || '导出失败' });
  }
});

// ── 删除某任务的全部 LLM 预标注（用于重新预标注）─────────────────────────
router.delete('/task/:taskId/llm', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: '无效的任务 ID' });
    const result = await Annotation.deleteMany({ taskId, fromLLM: true });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

// ── 批量审核（先注册，避免被 /:annId/review 路由拦截）──────────────────────
router.post('/batch-review', authRequired, adminOnly, async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids 数组不能为空' });
    }
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status 必须为 approved 或 rejected' });
    }
    const validIds = ids.filter(isValidObjectId);
    if (validIds.length === 0) {
      return res.status(400).json({ error: '无有效标注 ID' });
    }
    const result = await Annotation.updateMany(
      { _id: { $in: validIds } },
      { $set: { status, reviewedBy: req.user.id, reviewedAt: new Date() } }
    );
    res.json({ updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message || '批量审核失败' });
  }
});

// ── 单条审核 ────────────────────────────────────────────────────────────────
router.patch('/:annId/review', authRequired, adminOnly, async (req, res) => {
  try {
    const { annId } = req.params;
    if (!isValidObjectId(annId)) return res.status(400).json({ error: '无效的标注 ID' });
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status 必须为 approved 或 rejected' });
    }
    const ann = await Annotation.findByIdAndUpdate(
      annId,
      { $set: { status, reviewedBy: req.user.id, reviewedAt: new Date() } },
      { new: true }
    );
    if (!ann) return res.status(404).json({ error: '标注不存在' });
    res.json(ann);
  } catch (err) {
    res.status(500).json({ error: err.message || '审核失败' });
  }
});

export default router;

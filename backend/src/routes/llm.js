import express from 'express';
import axios from 'axios';
import Sample from '../models/Sample.js';
import Annotation from '../models/Annotation.js';
import Task from '../models/Task.js';
import { authRequired, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// LLM 后端抽象：Ollama / Claude API
// ============================================================

async function chatOllama(prompt, { base, model, timeout = 30000 }) {
  const resp = await axios.post(
    `${base}/api/chat`,
    { model, messages: [{ role: 'user', content: prompt }], stream: false },
    { timeout }
  );
  return (resp.data?.message?.content || '').trim();
}

async function chatClaude(prompt, { apiKey, model, timeout = 60000 }) {
  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 512,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }
  );
  const content = resp.data?.content;
  if (Array.isArray(content) && content.length > 0) {
    return (content[0].text || '').trim();
  }
  return '';
}

/**
 * 统一 chat 调用入口
 * @param {string} prompt
 * @param {object} opts - { backend, ollamaBase, ollamaModel, claudeApiKey, claudeModel }
 */
async function chatLLM(prompt, opts) {
  if (opts.backend === 'claude') {
    return chatClaude(prompt, {
      apiKey: opts.claudeApiKey,
      model: opts.claudeModel || 'claude-sonnet-4-20250514',
    });
  }
  return chatOllama(prompt, {
    base: opts.ollamaBase || 'http://localhost:11434',
    model: opts.ollamaModel || 'qwen3:14b',
  });
}

// 获取当前 LLM 配置（含 Ollama 已安装模型列表）
router.get('/config', authRequired, async (req, res) => {
  const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // 动态拉取 Ollama 本地已安装的模型
  let ollamaModels = [];
  try {
    const resp = await axios.get(`${ollamaBase}/api/tags`, { timeout: 5000 });
    ollamaModels = (resp.data?.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
    }));
  } catch {
    // Ollama 未启动或不可达时返回空列表
  }

  res.json({
    ollamaBase,
    ollamaModels,
    defaultOllamaModel: process.env.OLLAMA_MODEL || 'qwen3:14b',
    claudeAvailable: !!process.env.ANTHROPIC_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  });
});

// 对任务中的一批样本进行 LLM 预标注（支持 Ollama 和 Claude API）
router.post('/tasks/:taskId/prelabel', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { limit = 20, backend = 'ollama', model } = req.body;

    const task = await Task.findById(taskId).lean();
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (!task.labels || task.labels.length === 0) {
      return res.status(400).json({ error: 'task labels not configured' });
    }

    // Claude API 需要 API Key
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (backend === 'claude' && !claudeApiKey) {
      return res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY 环境变量，无法使用 Claude API' });
    }

    const annotatedSampleIds = await Annotation.find({ taskId, fromLLM: true }).distinct('sampleId');

    const samples = await Sample.find({
      taskId,
      _id: { $nin: annotatedSampleIds }
    })
      .limit(limit)
      .lean();

    if (!samples.length) {
      return res.json({ count: 0 });
    }

    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const ollamaModel = model || process.env.OLLAMA_MODEL || 'qwen3:14b';
    const claudeModel = model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

    const llmOpts = {
      backend,
      ollamaBase,
      ollamaModel,
      claudeApiKey,
      claudeModel,
    };

    console.log(`[预标注] 后端: ${backend}, 模型: ${backend === 'claude' ? claudeModel : ollamaModel}, 样本数: ${samples.length}`);

    // ── NER 任务预标注 ────────────────────────────────────────────────────
    if (task.type === 'ner') {
      const results = await Promise.allSettled(
        samples.map(async (s) => {
          let validatedSpans = [];
          try {
            const prompt = `你是一个命名实体识别助手。请从以下文本中识别所有命名实体，以JSON数组格式输出，每项包含：
- "text"：实体原文（必须与文本中完全一致）
- "label"：实体类型（只能是以下之一：${task.labels.join('、')}）

只输出JSON数组，不要有任何其他内容，不要解释。
示例格式：[{"text":"张伟","label":"PER"},{"text":"北京","label":"LOC"}]

文本：${s.content}`;

            const raw = await chatLLM(prompt, llmOpts);
            console.log(`[NER预标注] 后端: ${backend}, 原始响应: ${raw.slice(0, 200)}`);

            // 提取 JSON 数组（兼容 LLM 在数组前后输出多余文字的情况）
            const match = raw.match(/\[[\s\S]*?\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              // 由代码计算 start/end，不依赖 LLM 的偏移量
              let searchFrom = 0;
              for (const item of parsed) {
                if (!item.text || !task.labels.includes(item.label)) continue;
                const idx = s.content.indexOf(item.text, searchFrom);
                if (idx !== -1) {
                  validatedSpans.push({
                    start: idx,
                    end:   idx + item.text.length,
                    label: item.label,
                    text:  item.text,
                  });
                  searchFrom = idx + item.text.length;
                } else {
                  // 从头再找一次（防止顺序错乱）
                  const idx2 = s.content.indexOf(item.text);
                  if (idx2 !== -1 && !validatedSpans.some(sp => sp.start <= idx2 && idx2 < sp.end)) {
                    validatedSpans.push({ start: idx2, end: idx2 + item.text.length, label: item.label, text: item.text });
                  }
                }
              }
              console.log(`[NER预标注] 有效 spans: ${validatedSpans.length}/${parsed.length}`);
            }
          } catch (err) {
            console.error(`[NER ${backend}] LLM 调用失败:`, err.message || err);
          }

          await Annotation.create({
            taskId,
            sampleId: s._id,
            userId: null,
            label: null,
            spans: validatedSpans,
            fromLLM: true,
            confidence: 0.9,
            status: 'pending',
          });
        })
      );

      const created = results.filter((r) => r.status === 'fulfilled').length;
      return res.json({ count: created });
    }

    // ── 文本分类任务预标注 ────────────────────────────────────────────────
    const results = await Promise.allSettled(
      samples.map(async (s) => {
        let predicted = task.labels[0];
        try {
          const prompt = `你是一个文本分类助手。请从下列标签中选出一个最合适的：${task.labels.join(
            ' / '
          )}。请只输出标签本身。\n\n文本：\n${s.content}`;

          const raw = await chatLLM(prompt, llmOpts);
          const found = task.labels.find((l) => raw.includes(l));
          if (found) predicted = found;
        } catch (err) {
          console.error(`[${backend}] LLM 调用失败:`, err.message || err);
        }

        await Annotation.create({
          taskId,
          sampleId: s._id,
          userId: null,
          label: predicted,
          spans: [],
          fromLLM: true,
          confidence: 0.9,
          status: 'pending',
        });
      })
    );

    const created = results.filter((r) => r.status === 'fulfilled').length;
    res.json({ count: created });
  } catch (err) {
    res.status(500).json({ error: err.message || '预标注失败' });
  }
});

// LLM 数据生成：根据任务标签生成新的样本数据
router.post('/tasks/:taskId/generate-samples', authRequired, adminOnly, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { count = 10, label, backend = 'ollama', model } = req.body;

    const task = await Task.findById(taskId).lean();
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (!task.labels || task.labels.length === 0) {
      return res.status(400).json({ error: 'task labels not configured' });
    }

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (backend === 'claude' && !claudeApiKey) {
      return res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY 环境变量' });
    }

    const llmOpts = {
      backend,
      ollamaBase: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      ollamaModel: model || process.env.OLLAMA_MODEL || 'qwen3:14b',
      claudeApiKey,
      claudeModel: model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    };

    const targetLabel = label || task.labels[0];

    const buildPrompt = (lbl) => task.type === 'ner'
      ? `请生成一段自然语言文本，要求文本中自然地包含"${lbl}"类型的实体（可用实体类型：${task.labels.join('/')}）。要求：1. 文本长度在20-80字之间；2. 内容真实自然，不要写"某某是XXX类型实体"这样的解释性语句；3. 只输出文本内容，不要有任何说明。`
      : `请生成一条属于"${lbl}"类别的文本样本。要求：1. 文本长度在10-50字之间；2. 内容自然、真实；3. 只输出文本内容，不要输出其他说明。`;

    const results = await Promise.allSettled(
      Array.from({ length: count }, async () => {
        const prompt = buildPrompt(targetLabel);

        const content = await chatLLM(prompt, llmOpts);
        if (!content || content.length <= 5) return null;

        return Sample.create({
          taskId,
          content,
          meta: { generatedBy: 'llm', targetLabel }
        });
      })
    );

    const generated = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    res.json({ count: generated.length, samples: generated });
  } catch (err) {
    res.status(500).json({ error: err.message || '生成样本失败' });
  }
});

export default router;

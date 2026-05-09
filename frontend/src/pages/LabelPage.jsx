import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Tag, message, Spin, Tooltip } from 'antd';
import { RobotOutlined, ArrowLeftOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import client from '../api/client.js';

const LABEL_COLORS = [
  { bg: '#6366f1', light: '#eef2ff', border: '#c7d2fe' },
  { bg: '#10b981', light: '#ecfdf5', border: '#6ee7b7' },
  { bg: '#f59e0b', light: '#fffbeb', border: '#fcd34d' },
  { bg: '#ef4444', light: '#fef2f2', border: '#fca5a5' },
  { bg: '#8b5cf6', light: '#f5f3ff', border: '#c4b5fd' },
  { bg: '#06b6d4', light: '#ecfeff', border: '#a5f3fc' },
];

// 将 spans 渲染为带高亮的文本节点列表
function renderAnnotatedText(content, spans, labels, onDeleteSpan) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start > cursor) {
      segments.push({ type: 'text', text: content.slice(cursor, span.start) });
    }
    segments.push({ type: 'span', span });
    cursor = span.end;
  }
  if (cursor < content.length) {
    segments.push({ type: 'text', text: content.slice(cursor) });
  }

  return segments.map((seg, i) => {
    if (seg.type === 'text') return <span key={i}>{seg.text}</span>;
    const idx = labels.indexOf(seg.span.label);
    const color = LABEL_COLORS[idx >= 0 ? idx % LABEL_COLORS.length : 0];
    return (
      <mark key={i} style={{
        background: color.light,
        borderBottom: `2px solid ${color.bg}`,
        borderRadius: 3,
        padding: '0 2px',
        position: 'relative',
        cursor: 'default',
      }}>
        {seg.span.text}
        <sup style={{ fontSize: 10, color: color.bg, fontWeight: 700, marginLeft: 2 }}>{seg.span.label}</sup>
        <Button
          type="text" size="small"
          style={{ fontSize: 10, color: '#94a3b8', padding: '0 2px', height: 'auto', lineHeight: 1, marginLeft: 1 }}
          onClick={() => onDeleteSpan(seg.span)}
        >×</Button>
      </mark>
    );
  });
}

export default function LabelPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const textRef = useRef(null);

  const [sample, setSample]     = useState(null);
  const [labels, setLabels]     = useState([]);
  const [taskType, setTaskType] = useState('text_classification');
  const [loading, setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);

  // NER 专用 state
  const [spans, setSpans]             = useState([]);   // 当前标注的 spans
  const [llmSuggestions, setLlmSuggestions] = useState([]); // AI 建议 spans（原始备份）
  const [menuPos, setMenuPos]         = useState(null); // { x, y, start, end, text }

  const fetchNext = async () => {
    setLoading(true);
    setMenuPos(null);
    try {
      const { data } = await client.get(`/tasks/${taskId}/next-sample`);
      if (!data.sample) {
        setDone(true);
        setSample(null);
      } else {
        setDone(false);
        setSample(data.sample);
        setLabels(data.labels || []);
        setTaskType(data.taskType || 'text_classification');
        // NER：初始化已有 spans（优先 existingSpans，否则用 LLM 建议 spans）
        if (data.taskType === 'ner') {
          const llmSpans = data.sample.llmSpans || [];
          setLlmSuggestions(llmSpans);
          const initial = (data.sample.existingSpans?.length > 0)
            ? data.sample.existingSpans
            : llmSpans;
          setSpans(initial);
        } else {
          setSpans([]);
          setLlmSuggestions([]);
        }
      }
    } catch {
      message.error('加载样本失败');
    } finally {
      setLoading(false);
    }
  };

  // 文本分类提交
  const submitLabel = async (label) => {
    if (!sample || submitting) return;
    setSubmitting(true);
    try {
      await client.post('/annotations', { taskId, sampleId: sample._id, label });
      fetchNext();
    } catch {
      message.error('提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // NER 提交
  const submitSpans = async () => {
    if (!sample || submitting) return;
    setSubmitting(true);
    try {
      await client.post('/annotations', { taskId, sampleId: sample._id, spans });
      message.success('已提交，加载下一条');
      fetchNext();
    } catch {
      message.error('提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // NER：鼠标抬起时计算选区偏移
  const handleMouseUp = (e) => {
    if (taskType !== 'ner') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const containerEl = textRef.current;
    if (!containerEl || !containerEl.contains(sel.anchorNode)) return;

    const range = sel.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) { sel.removeAllRanges(); return; }

    // 计算字符偏移（相对于 containerEl 的纯文本内容）
    const preRange = range.cloneRange();
    preRange.selectNodeContents(containerEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + text.length;

    sel.removeAllRanges();
    setMenuPos({ x: e.clientX, y: e.clientY, start, end, text });
  };

  // NER：点击外部关闭浮框
  useEffect(() => {
    if (!menuPos) return;
    const handler = (e) => {
      const menu = document.getElementById('ner-label-menu');
      if (menu && !menu.contains(e.target)) setMenuPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuPos]);

  useEffect(() => { fetchNext(); }, [taskId]);

  // 键盘快捷键：文本分类 1-9 直接提交；NER Enter 提交
  useEffect(() => {
    const handler = (e) => {
      if (submitting || loading || !sample) return;
      // 如果焦点在 input/textarea 内，不触发
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (taskType === 'text_classification') {
        const idx = parseInt(e.key, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < labels.length) {
          submitLabel(labels[idx]);
        }
      } else if (taskType === 'ner' && (e.key === 'Enter') && !menuPos) {
        submitSpans();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [taskType, labels, sample, submitting, loading, menuPos]);

  if (loading && !sample && !done) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (done || (!loading && !sample)) {
    return (
      <div className="label-root">
        <div className="label-empty">
          <div className="label-empty-icon">🎉</div>
          <div className="label-empty-title">全部完成！</div>
          <p className="label-empty-desc">该任务下暂无更多待标注样本，辛苦了。</p>
          <Button icon={<ArrowLeftOutlined />} style={{ marginTop: 20 }} onClick={() => navigate('/label')}>
            返回任务列表
          </Button>
        </div>
      </div>
    );
  }

  const isNer = taskType === 'ner';

  return (
    <div className="label-root">
      <div className="label-card" style={{ maxWidth: isNer ? 860 : 700 }}>
        {/* 卡片顶部 */}
        <div className="label-card-header">
          <Button
            type="text" icon={<ArrowLeftOutlined />} size="small"
            style={{ color: '#64748b', padding: '0 4px' }}
            onClick={() => navigate('/label')}
          >
            返回列表
          </Button>
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
            {isNer ? '命名实体识别' : '文本分类标注'}
          </span>
        </div>

        {/* 卡片主体 */}
        <div className="label-card-body">
          <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            待标注文本
          </div>

          {/* 样本文本区域 */}
          <Spin spinning={loading}>
            {isNer ? (
              <div
                ref={textRef}
                className="label-text"
                style={{ cursor: 'text', userSelect: 'text', lineHeight: 2, minHeight: 60 }}
                onMouseUp={handleMouseUp}
              >
                {sample?.content
                  ? renderAnnotatedText(sample.content, spans, labels, (spanToDelete) => {
                      setSpans(spans.filter(s => !(s.start === spanToDelete.start && s.end === spanToDelete.end)));
                    })
                  : null}
              </div>
            ) : (
              <div className="label-text">{sample?.content}</div>
            )}
          </Spin>

          {/* NER 操作提示 */}
          {isNer && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, marginTop: -4 }}>
              💡 拖选文本 → 从弹出菜单选择实体类型；点击 × 删除标注
            </div>
          )}

          {/* 文本分类：LLM 建议 */}
          {!isNer && sample?.llmSuggestion && (
            <div className="label-suggestion">
              <RobotOutlined />
              <span>AI 建议：</span>
              <strong>{sample.llmSuggestion}</strong>
            </div>
          )}

          {/* NER：AI 建议实体面板 */}
          {isNer && llmSuggestions.length > 0 && (
            <div style={{
              background: '#f5f3ff', border: '1px solid #e9d5ff', borderRadius: 8,
              padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RobotOutlined style={{ color: '#7c3aed' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>
                    AI 建议实体（{llmSuggestions.length} 个）
                  </span>
                </div>
                <Button
                  size="small"
                  type="text"
                  onClick={() => setSpans([...llmSuggestions])}
                  style={{ fontSize: 12, color: '#7c3aed', padding: '0 8px', height: 24, fontWeight: 600 }}
                >
                  采用 AI 建议
                </Button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {llmSuggestions.map((s, i) => {
                  const idx = labels.indexOf(s.label);
                  const color = LABEL_COLORS[idx >= 0 ? idx % LABEL_COLORS.length : 0];
                  return (
                    <Tag key={i} style={{
                      borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '2px 10px',
                      background: color.light, border: `1px solid ${color.border}`, color: color.bg,
                    }}>
                      <span style={{ color: '#64748b', fontWeight: 400, marginRight: 4 }}>{s.label}</span>
                      {s.text}
                    </Tag>
                  );
                })}
              </div>
            </div>
          )}

          {/* NER：已标注实体列表 */}
          {isNer && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                已标注实体 ({spans.length})
              </div>
              {spans.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {spans.map((s, i) => {
                    const idx = labels.indexOf(s.label);
                    const color = LABEL_COLORS[idx >= 0 ? idx % LABEL_COLORS.length : 0];
                    return (
                      <Tag key={i} closable onClose={() => setSpans(spans.filter((_, j) => j !== i))}
                        style={{
                          borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '2px 10px',
                          background: color.light, border: `1px solid ${color.border}`, color: color.bg,
                        }}>
                        <span style={{ color: '#64748b', fontWeight: 400, marginRight: 4 }}>{s.label}</span>
                        {s.text}
                      </Tag>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>暂无标注，请拖选文本添加实体</span>
              )}
            </div>
          )}

          {/* 分类：标签按钮 */}
          {!isNer && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                选择标签
                <span style={{ marginLeft: 8, fontWeight: 400, color: '#cbd5e1', textTransform: 'none', letterSpacing: 0 }}>
                  · 可按数字键快速选择
                </span>
              </div>
              <div className="label-buttons">
                {labels.map((l, i) => {
                  const color = LABEL_COLORS[i % LABEL_COLORS.length];
                  return (
                    <Button
                      key={l}
                      className="label-btn"
                      loading={submitting}
                      onClick={() => submitLabel(l)}
                      style={{ background: color.bg, borderColor: color.bg, color: '#fff', position: 'relative' }}
                    >
                      {i < 9 && (
                        <span style={{
                          position: 'absolute', top: -7, left: -7,
                          background: 'rgba(0,0,0,0.45)', color: '#fff',
                          borderRadius: '50%', width: 16, height: 16,
                          fontSize: 10, fontWeight: 700, display: 'flex',
                          alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        }}>
                          {i + 1}
                        </span>
                      )}
                      {l}
                    </Button>
                  );
                })}
              </div>
            </>
          )}

          {/* NER：实体类型快捷按钮 + 提交 */}
          {isNer && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                实体类型
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {labels.map((l, i) => {
                  const color = LABEL_COLORS[i % LABEL_COLORS.length];
                  return (
                    <Tag key={l} style={{
                      borderRadius: 20, fontSize: 12, fontWeight: 600, padding: '3px 12px', cursor: 'default',
                      background: color.light, border: `1px solid ${color.border}`, color: color.bg,
                    }}>
                      {l}
                    </Tag>
                  );
                })}
              </div>
              <Button
                type="primary" icon={<CheckOutlined />}
                loading={submitting}
                onClick={submitSpans}
                style={{ width: '100%', fontWeight: 600, height: 40 }}
              >
                提交并下一条
                <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7, fontWeight: 400 }}>Enter</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* NER 浮动实体类型选择菜单 */}
      {menuPos && (
        <div
          id="ner-label-menu"
          style={{
            position: 'fixed',
            left: menuPos.x,
            top: menuPos.y - 48,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '8px 8px 6px',
            zIndex: 2000,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxWidth: 340,
            minWidth: 160,
          }}
        >
          <div style={{ width: '100%', fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>
            选择实体类型：<span style={{ color: '#334155', fontWeight: 700 }}>"{menuPos.text.slice(0, 20)}{menuPos.text.length > 20 ? '…' : ''}"</span>
          </div>
          {labels.map((l, i) => {
            const color = LABEL_COLORS[i % LABEL_COLORS.length];
            return (
              <Button
                key={l} size="small"
                style={{
                  background: color.bg, color: '#fff', border: 'none',
                  borderRadius: 20, fontWeight: 600, fontSize: 12,
                }}
                onClick={() => {
                  const newSpan = { start: menuPos.start, end: menuPos.end, label: l, text: menuPos.text };
                  const overlaps = spans.some(s => s.start < newSpan.end && s.end > newSpan.start);
                  if (overlaps) {
                    message.warning('与已有标注区间重叠，请先删除已有标注');
                  } else {
                    setSpans([...spans, newSpan]);
                  }
                  setMenuPos(null);
                }}
              >
                {l}
              </Button>
            );
          })}
          <Button size="small" style={{ borderRadius: 20, fontSize: 12 }} onClick={() => setMenuPos(null)}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

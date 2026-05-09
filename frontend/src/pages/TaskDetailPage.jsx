import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Table, Button, Space, Form, Input, message, Popconfirm, Select,
  Tag, Row, Col, InputNumber, Progress, Tooltip, Modal, Upload } from 'antd';
import { DownloadOutlined, RobotOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PlusOutlined, ArrowLeftOutlined, ThunderboltOutlined, ExperimentOutlined,
  FileTextOutlined, AuditOutlined, DotChartOutlined,
  CheckOutlined, CloseOutlined, UserOutlined, UploadOutlined } from '@ant-design/icons';
import { Column, Line } from '@ant-design/charts';
import client from '../api/client.js';

const { TextArea } = Input;
const { Option } = Select;

const LABEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// 准确率颜色
function accuracyColor(v) {
  if (!v && v !== 0) return '#94a3b8';
  const p = v * 100;
  if (p >= 70) return '#10b981';
  if (p >= 50) return '#f59e0b';
  return '#ef4444';
}

// 小节标题
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: '#94a3b8',
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12
    }}>
      {children}
    </div>
  );
}

// 操作面板卡片（左边彩色竖线）
function ActionPanel({ color = '#6366f1', icon, title, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
      borderLeft: `3px solid ${color}`, padding: '16px 20px', marginBottom: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color, fontSize: 15 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [samples, setSamples] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [sampleForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [distillMode, setDistillMode] = useState('simple');
  const [distillTemperature, setDistillTemperature] = useState(3.0);
  const [distillMaxFeatures, setDistillMaxFeatures] = useState(5000);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importLines, setImportLines] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [predictText, setPredictText] = useState('');
  const [predictResult, setPredictResult] = useState(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [llmBackend, setLlmBackend] = useState('ollama');
  const [llmModel, setLlmModel] = useState('');
  const [llmConfig, setLlmConfig] = useState(null);

  // 用户列表（仅用于审核 tab 显示标注员姓名）
  const [allUsers, setAllUsers] = useState([]);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  })();
  const isAdmin = user?.role === 'admin';

  const fetchTask = async () => {
    try {
      const { data } = await client.get('/tasks');
      setTask(data.find((x) => x._id === taskId) || null);
    } catch { message.error('加载任务信息失败'); }
  };

  const fetchSamples = async () => {
    setLoadingSamples(true);
    try {
      const { data } = await client.get(`/tasks/${taskId}/samples`, { params: { page: 1, pageSize: 100 } });
      setSamples(data.items || []);
    } catch { message.error('加载样本失败'); }
    finally { setLoadingSamples(false); }
  };

  const fetchAnnotations = async () => {
    setLoadingAnnotations(true);
    try {
      const { data } = await client.get(`/annotations/task/${taskId}`);
      setAnnotations(data || []);
    } catch { message.error('加载标注数据失败'); }
    finally { setLoadingAnnotations(false); }
  };

  const fetchMetrics = async () => {
    try {
      const { data } = await client.get(`/distill/tasks/${taskId}/metrics`);
      setMetrics(data);
    } catch (err) { console.error('加载指标失败', err); }
  };

  const fetchAllUsers = async () => {
    if (!isAdmin) return;
    try {
      const { data } = await client.get('/users');
      setAllUsers(data || []);
    } catch (err) { console.error('加载用户列表失败', err); }
  };

  const fetchLlmConfig = async () => {
    try {
      const { data } = await client.get('/llm/config');
      setLlmConfig(data);
    } catch (err) { console.error('加载 LLM 配置失败', err); }
  };

  useEffect(() => {
    fetchTask(); fetchSamples(); fetchAnnotations(); fetchMetrics();
    fetchAllUsers(); fetchLlmConfig();
  }, [taskId]);

  const handleAddSample = async () => {
    try {
      const values = await sampleForm.validateFields();
      await client.post(`/tasks/${taskId}/samples`, { content: values.content });
      message.success('添加样本成功');
      sampleForm.resetFields();
      fetchSamples();
    } catch (err) {
      if (err?.response) message.error(err.response.data?.error || '添加样本失败');
    }
  };

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      let lines;
      if (file.name.endsWith('.csv')) {
        // CSV：取每行第一列（逗号或 Tab 分隔）
        lines = text.split(/\r?\n/).map((l) => l.split(/[,\t]/)[0].trim()).filter(Boolean);
      } else {
        // TXT：每行一条
        lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      }
      setImportLines(lines);
      setImportModal(true);
    };
    reader.readAsText(file, 'utf-8');
    return false; // 阻止 Upload 自动上传
  };

  const handleImportConfirm = async () => {
    setImportLoading(true);
    try {
      const { data } = await client.post(`/tasks/${taskId}/samples/import`, { lines: importLines });
      message.success(`成功导入 ${data.imported} 条样本`);
      setImportModal(false);
      setImportLines([]);
      fetchSamples();
    } catch (err) {
      message.error(err.response?.data?.error || '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  const currentModelLabel = () => {
    if (llmBackend === 'claude') return `Claude API (${llmModel || llmConfig?.claudeModel || 'claude-sonnet-4-20250514'})`;
    return `Ollama (${llmModel || llmConfig?.defaultOllamaModel || 'qwen3:14b'})`;
  };

  const handlePrelabel = async () => {
    try {
      message.loading(`正在使用 ${currentModelLabel()} 预标注...`, 0);
      const payload = { limit: 50, backend: llmBackend };
      if (llmModel) payload.model = llmModel;
      await client.post(`/llm/tasks/${taskId}/prelabel`, payload);
      message.destroy();
      message.success(`已完成 ${currentModelLabel()} 预标注`);
      fetchAnnotations();
    } catch (err) {
      message.destroy();
      message.error(err.response?.data?.error || '预标注失败');
    }
  };

  const handleResetPrelabel = async () => {
    try {
      message.loading('正在清除旧预标注...', 0);
      const { data: delData } = await client.delete(`/annotations/task/${taskId}/llm`);
      message.destroy();
      message.info(`已清除 ${delData.deleted} 条 LLM 预标注`);
      message.loading(`正在使用 ${currentModelLabel()} 重新预标注...`, 0);
      const payload = { limit: 50, backend: llmBackend };
      if (llmModel) payload.model = llmModel;
      await client.post(`/llm/tasks/${taskId}/prelabel`, payload);
      message.destroy();
      message.success(`已使用 ${currentModelLabel()} 重新预标注`);
      fetchAnnotations();
    } catch (err) {
      message.destroy();
      message.error(err.response?.data?.error || '重置预标注失败');
    }
  };

  const handlePredict = async () => {
    if (!predictText.trim()) return;
    setPredictLoading(true);
    setPredictResult(null);
    try {
      const { data } = await client.post(`/distill/tasks/${taskId}/predict`, { text: predictText });
      setPredictResult(data);
    } catch (err) {
      message.error(err.response?.data?.error || '推理失败');
    } finally {
      setPredictLoading(false);
    }
  };

  const handleDistill = async () => {
    try {
      const isNer = task?.type === 'ner';
      const modeText = isNer ? 'NER实体词典' :
                       distillMode === 'advanced' ? '高级模式' :
                       distillMode === 'advanced_lite' ? '高级（轻量）' : '简单模式';
      message.loading(`正在训练蒸馏模型（${modeText}）...`, 0);
      const requestBody = { mode: isNer ? 'ner' : distillMode };
      if (!isNer && (distillMode === 'advanced' || distillMode === 'advanced_lite')) {
        requestBody.temperature = distillTemperature;
        requestBody.maxFeatures = distillMaxFeatures;
      }
      const { data } = await client.post(`/distill/tasks/${taskId}/distill`, requestBody);
      message.destroy();
      if (data.ok) {
        message.success(`蒸馏训练完成（${modeText}）！`);
        if (data.metrics) setMetrics(prev => ({ ...prev, ...data.metrics }));
        setTimeout(() => fetchMetrics(), 1000);
        if (data.metrics) {
          message.info(`训练数据：总标注${data.metrics.totalAnnotations}条，LLM标注${data.metrics.llmAnnotations}条，人工标注${data.metrics.humanAnnotations}条`);
        }
      } else {
        message.error(data.error || '蒸馏训练失败');
        if (data.details) console.error('蒸馏训练错误详情:', data.details);
      }
    } catch (err) {
      message.destroy();
      message.error(err.response?.data?.error || err.response?.data?.details || '蒸馏训练触发失败');
      if (err.response?.data?.hint) message.warning(err.response.data.hint);
    }
  };

  const handleGenerateSamples = async () => {
    try {
      const values = await generateForm.validateFields();
      message.loading('正在生成样本...', 0);
      const { data } = await client.post(`/llm/tasks/${taskId}/generate-samples`, {
        count: values.count || 10, label: values.label
      });
      message.destroy();
      message.success(`成功生成 ${data.count} 条样本`);
      generateForm.resetFields();
      fetchSamples();
    } catch (err) {
      message.destroy();
      message.error(err.response?.data?.error || '生成样本失败');
    }
  };

  const handleReview = async (annId, status) => {
    setReviewLoading(true);
    try {
      await client.patch(`/annotations/${annId}/review`, { status });
      message.success(status === 'approved' ? '已通过' : '已拒绝');
      fetchAnnotations();
    } catch { message.error('审核操作失败'); }
    finally { setReviewLoading(false); }
  };

  const handleBatchReview = async (status) => {
    if (selectedRowKeys.length === 0) return;
    setReviewLoading(true);
    try {
      const { data } = await client.post('/annotations/batch-review', { ids: selectedRowKeys, status });
      message.success(`批量操作成功：${data.updated} 条已更新`);
      setSelectedRowKeys([]);
      fetchAnnotations();
    } catch { message.error('批量审核失败'); }
    finally { setReviewLoading(false); }
  };

  const handleExport = async (format) => {
    try {
      const response = await client.get(`/annotations/task/${taskId}/export`, {
        params: { format }, responseType: format === 'csv' ? 'blob' : 'json'
      });
      const blob = format === 'csv'
        ? new Blob([response.data], { type: 'text/csv' })
        : new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `annotations_${taskId}.${format}`);
      document.body.appendChild(link); link.click(); link.remove();
      message.success(`导出 ${format.toUpperCase()} 成功`);
    } catch { message.error('导出失败'); }
  };

  const sampleColumns = [
    {
      title: '样本文本', dataIndex: 'content', ellipsis: true,
      render: (text) => <span style={{ color: '#334155', fontSize: 13.5 }}>{text}</span>
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 170,
      render: (v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v ? new Date(v).toLocaleString('zh-CN') : '-'}</span>
    }
  ];

  const annotationData = annotations.map((ann) => ({
    ...ann, content: samples.find((s) => s._id === ann.sampleId)?.content || '-'
  }));

  // ── 审核 Tab 辅助 ────────────────────────────────────────────────────────
  const statusTag = (status) => {
    const map = {
      pending:  { color: '#d97706', bg: '#fffbeb', border: '#fcd34d', text: '待审核' },
      approved: { color: '#059669', bg: '#ecfdf5', border: '#6ee7b7', text: '已通过' },
      rejected: { color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', text: '已拒绝' },
    };
    const s = status || 'approved';
    const c = map[s] || map.approved;
    return <Tag style={{ borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '1px 8px', background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>{c.text}</Tag>;
  };

  const annStats = {
    total:    annotationData.length,
    pending:  annotationData.filter(a => (a.status || 'approved') === 'pending').length,
    approved: annotationData.filter(a => (a.status || 'approved') === 'approved').length,
    rejected: annotationData.filter(a => a.status === 'rejected').length,
  };

  const filteredAnnotations = annotationData.filter(a => {
    if (reviewFilter === 'all') return true;
    return (a.status || 'approved') === reviewFilter;
  });

  const reviewColumns = [
    {
      title: '样本文本', dataIndex: 'content', ellipsis: true,
      render: (t) => <span style={{ fontSize: 13, color: '#334155' }}>{t}</span>
    },
    {
      title: '标签 / 实体',
      render: (_, r) => {
        if (r.spans && r.spans.length > 0) {
          return (
            <Space size={[4, 4]} wrap>
              {r.spans.map((s, i) => (
                <Tag key={i} style={{ borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '1px 8px',
                  background: LABEL_COLORS[i % LABEL_COLORS.length] + '20',
                  border: `1px solid ${LABEL_COLORS[i % LABEL_COLORS.length]}60`,
                  color: LABEL_COLORS[i % LABEL_COLORS.length] }}>
                  {s.label}: {s.text}
                </Tag>
              ))}
            </Space>
          );
        }
        if (r.label) {
          return <Tag style={{ borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px',
            background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>{r.label}</Tag>;
        }
        // NER 标注但 spans 为空（LLM 未识别到实体）
        if (r.spans !== undefined) {
          return <span style={{ color: '#cbd5e1', fontSize: 12 }}>未识别到实体</span>;
        }
        return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
      }
    },
    {
      title: '来源', dataIndex: 'fromLLM', width: 100,
      render: (fromLLM) => (
        <Tag icon={fromLLM ? <RobotOutlined /> : <UserOutlined />} style={{
          borderRadius: 20, fontWeight: 500, fontSize: 12, padding: '1px 8px',
          background: fromLLM ? '#f5f3ff' : '#ecfdf5',
          border: `1px solid ${fromLLM ? '#c4b5fd' : '#6ee7b7'}`,
          color: fromLLM ? '#7c3aed' : '#059669',
        }}>{fromLLM ? 'LLM' : '人工'}</Tag>
      )
    },
    {
      title: '标注员', dataIndex: 'userId', width: 110,
      render: (uid, r) => {
        if (r.fromLLM) return <span style={{ fontSize: 12, color: '#c4b5fd' }}>—</span>;
        const u = allUsers.find((x) => x._id === uid || x._id === uid?.toString?.());
        return u
          ? <Tag icon={<UserOutlined />} style={{ borderRadius: 20, fontSize: 11, padding: '0 7px', background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#059669' }}>{u.username}</Tag>
          : <span style={{ fontSize: 11, color: '#94a3b8' }}>{uid ? String(uid).slice(-6) : '—'}</span>;
      }
    },
    {
      title: '状态', dataIndex: 'status', width: 96,
      render: (status) => statusTag(status),
    },
    {
      title: '操作', width: 150,
      render: (_, r) => r.fromLLM ? (
        <Space size={4}>
          <Tooltip title="通过">
            <Popconfirm title="确认通过此标注？" onConfirm={() => handleReview(r._id, 'approved')} okText="确认" cancelText="取消">
              <Button size="small" type="primary" icon={<CheckOutlined />}
                style={{ background: '#10b981', borderColor: '#10b981', fontSize: 12 }} loading={reviewLoading}>
                通过
              </Button>
            </Popconfirm>
          </Tooltip>
          <Tooltip title="拒绝">
            <Popconfirm title="确认拒绝此标注？" onConfirm={() => handleReview(r._id, 'rejected')} okText="确认" cancelText="取消">
              <Button size="small" danger icon={<CloseOutlined />} style={{ fontSize: 12 }} loading={reviewLoading}>
                拒绝
              </Button>
            </Popconfirm>
          </Tooltip>
        </Space>
      ) : <span style={{ color: '#94a3b8', fontSize: 12 }}><UserOutlined style={{ marginRight: 4 }} />人工标注</span>
    },
    {
      title: '时间', dataIndex: 'createdAt', width: 155,
      render: (v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v ? new Date(v).toLocaleString('zh-CN') : '-'}</span>
    }
  ];

  // ── Tab 内容 ─────────────────────────────────────────

  const tabInfo = (
    <div style={{ padding: '8px 0' }}>
      {task ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '14px 24px', alignItems: 'start' }}>
            {[
              ['任务名称', task.name],
              ['任务描述', task.description || <span style={{ color: '#94a3b8' }}>暂无描述</span>],
              ['任务类型', <Tag color="purple" style={{ borderRadius: 20, fontWeight: 500 }}>{task.type}</Tag>],
              ['标签集合', (
                <Space size={[6, 6]} wrap>
                  {(task.labels || []).map((l, i) => (
                    <Tag key={l} style={{
                      borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px',
                      background: LABEL_COLORS[i % LABEL_COLORS.length] + '18',
                      border: `1px solid ${LABEL_COLORS[i % LABEL_COLORS.length]}40`,
                      color: LABEL_COLORS[i % LABEL_COLORS.length],
                    }}>{l}</Tag>
                  ))}
                </Space>
              )],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', paddingTop: 2 }}>{k}</span>
                <span style={{ fontSize: 13.5, color: '#0f172a' }}>{v}</span>
              </React.Fragment>
            ))}
          </div>

          {/* 任务分配提示（管理员） */}
          {isAdmin && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                任务与样本分配
              </div>
              <div style={{
                background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
                borderLeft: '3px solid #6366f1', padding: '14px 18px',
                fontSize: 13, color: '#64748b', lineHeight: 1.7,
              }}>
                任务与样本分配已统一至
                <strong style={{ color: '#6366f1' }}>「标注员管理」</strong>页面。
                <br />
                在标注员管理中点击"分配任务"，可为每名标注员选择任务并设置样本范围（第 N 条 ~ 第 M 条）。
              </div>
            </div>
          )}
        </>
      ) : <span style={{ color: '#94a3b8' }}>加载中…</span>}
    </div>
  );

  const tabSamples = isAdmin && (
    <div>
      {/* 操作区 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <ActionPanel color="#6366f1" icon={<PlusOutlined />} title="手动添加样本">
            <Form layout="vertical" form={sampleForm} size="small">
              <Form.Item name="content" rules={[{ required: true, message: '请输入样本文本' }]} style={{ marginBottom: 10 }}>
                <TextArea rows={2} placeholder="例如：这部电影真的很好看！" />
              </Form.Item>
              <Space>
                <Button type="primary" size="small" onClick={handleAddSample} style={{ fontWeight: 600 }}>
                  添加样本
                </Button>
                <Upload accept=".csv,.txt" showUploadList={false} beforeUpload={handleImportFile}>
                  <Button size="small" icon={<UploadOutlined />} style={{ fontWeight: 600 }}>
                    导入文件
                  </Button>
                </Upload>
              </Space>
            </Form>
          </ActionPanel>
        </Col>

        <Col xs={24} md={8}>
          <ActionPanel color="#8b5cf6" icon={<RobotOutlined />} title="LLM 数据生成">
            <Form layout="inline" form={generateForm} size="small" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Form.Item name="count" initialValue={10} label="数量" style={{ marginBottom: 8, marginRight: 0 }}>
                <InputNumber min={1} max={50} style={{ width: 70 }} />
              </Form.Item>
              <Form.Item name="label" label="标签" style={{ marginBottom: 8, marginRight: 0 }}>
                <Select placeholder="默认第一个" style={{ width: 110 }}>
                  {(task?.labels || []).map((l) => <Option key={l} value={l}>{l}</Option>)}
                </Select>
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Popconfirm
                  title="LLM 数据生成"
                  description="将调用本地 Ollama 生成新样本，是否继续？"
                  onConfirm={handleGenerateSamples}
                >
                  <Button type="primary" size="small" icon={<RobotOutlined />} style={{ fontWeight: 600, background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                    生成
                  </Button>
                </Popconfirm>
              </Form.Item>
            </Form>
          </ActionPanel>
        </Col>

        <Col xs={24} md={8}>
          <ActionPanel color="#10b981" icon={<ThunderboltOutlined />} title="LLM 预标注">
            <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 8, lineHeight: 1.6 }}>
              对尚未预标注的样本批量调用 LLM，自动生成预标注结果。
            </div>
            {/* 后端选择 */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>后端：</div>
              <Select
                size="small"
                value={llmBackend}
                onChange={(v) => { setLlmBackend(v); setLlmModel(''); }}
                style={{ width: '100%' }}
              >
                <Option value="ollama">Ollama 本地模型</Option>
                <Option value="claude" disabled={llmConfig && !llmConfig.claudeAvailable}>
                  Claude API{llmConfig && !llmConfig.claudeAvailable ? ' (未配置 API Key)' : ''}
                </Option>
              </Select>
            </div>
            {/* 模型选择 */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>模型：</div>
              {llmBackend === 'ollama' ? (
                <Select
                  size="small"
                  value={llmModel || llmConfig?.defaultOllamaModel || ''}
                  onChange={setLlmModel}
                  style={{ width: '100%' }}
                  placeholder="选择 Ollama 模型"
                >
                  {(llmConfig?.ollamaModels || []).map((m) => (
                    <Option key={m.name} value={m.name}>
                      {m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)}GB)` : ''}
                    </Option>
                  ))}
                </Select>
              ) : (
                <Select
                  size="small"
                  value={llmModel || llmConfig?.claudeModel || 'claude-sonnet-4-20250514'}
                  onChange={setLlmModel}
                  style={{ width: '100%' }}
                  disabled={llmConfig && !llmConfig.claudeAvailable}
                >
                  <Option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</Option>
                  <Option value="claude-haiku-4-20250414">claude-haiku-4-20250414</Option>
                </Select>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Popconfirm
                title="LLM 预标注"
                description={`将使用 ${currentModelLabel()} 对未预标注样本进行标注，是否继续？`}
                onConfirm={handlePrelabel}
              >
                <Button type="primary" size="small" style={{ fontWeight: 600, background: '#10b981', borderColor: '#10b981' }}>
                  触发预标注
                </Button>
              </Popconfirm>
              <Popconfirm
                title="重置并重新预标注"
                description={`将清除所有旧 LLM 预标注并使用 ${currentModelLabel()} 重新生成，是否继续？`}
                onConfirm={handleResetPrelabel}
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger style={{ fontWeight: 600 }}>
                  重置并重新预标注
                </Button>
              </Popconfirm>
            </div>
          </ActionPanel>
        </Col>
      </Row>

      {/* 蒸馏训练 */}
      {isAdmin && (
        <ActionPanel color="#f59e0b" icon={<ExperimentOutlined />} title="知识蒸馏训练">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
            {task?.type === 'ner' ? (
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
                NER 任务使用<strong style={{ color: '#f59e0b' }}>实体词典蒸馏</strong>：
                从已审核标注中提取实体词典，训练最长匹配学生模型。
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>蒸馏模式</div>
                  <Select value={distillMode} onChange={setDistillMode} style={{ width: 180 }} size="small">
                    <Option value="simple">简单模式</Option>
                    <Option value="advanced">高级模式</Option>
                    <Option value="advanced_lite">高级模式 · 轻量</Option>
                  </Select>
                </div>
                {(distillMode === 'advanced' || distillMode === 'advanced_lite') && (
                  <>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>温度参数</div>
                      <InputNumber min={0.1} max={10} step={0.1} value={distillTemperature} onChange={setDistillTemperature} style={{ width: 100 }} size="small" />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>最大特征数</div>
                      <InputNumber min={100} max={10000} step={100} value={distillMaxFeatures} onChange={setDistillMaxFeatures} style={{ width: 100 }} size="small" />
                    </div>
                  </>
                )}
              </>
            )}
            <Popconfirm
              title="蒸馏训练"
              description={task?.type === 'ner'
                ? '将从已审核 NER 标注中构建实体词典模型，确定继续吗？'
                : `将使用${distillMode === 'advanced' ? '高级' : distillMode === 'advanced_lite' ? '高级（轻量）' : '简单'}模式训练模型，确定继续吗？`}
              onConfirm={handleDistill}
            >
              <Button type="primary" size="small" icon={<ExperimentOutlined />}
                style={{ fontWeight: 600, background: '#f59e0b', borderColor: '#f59e0b' }}>
                触发蒸馏训练
              </Button>
            </Popconfirm>
          </div>
        </ActionPanel>
      )}

      {/* 样本列表 */}
      <SectionLabel>样本列表（共 {samples.length} 条）</SectionLabel>
      <div className="surface" style={{ overflow: 'hidden' }}>
        <Table
          rowKey="_id"
          dataSource={samples}
          columns={sampleColumns}
          loading={loadingSamples}
          bordered={false}
          size="middle"
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>

      {/* 批量导入预览 Modal */}
      <Modal
        title={`导入预览（共 ${importLines.length} 条）`}
        open={importModal}
        onOk={handleImportConfirm}
        onCancel={() => { setImportModal(false); setImportLines([]); }}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={importLoading}
        width={560}
      >
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12 }}>
          以下为解析结果预览（最多显示前 10 条），请确认后批量导入：
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', padding: '10px 14px', maxHeight: 300, overflowY: 'auto' }}>
          {importLines.slice(0, 10).map((line, i) => (
            <div key={i} style={{ fontSize: 13, color: '#334155', padding: '4px 0', borderBottom: i < Math.min(9, importLines.length - 1) ? '1px solid #f1f5f9' : 'none' }}>
              <span style={{ color: '#94a3b8', marginRight: 8, fontFamily: 'monospace', fontSize: 11 }}>{i + 1}.</span>
              {line}
            </div>
          ))}
          {importLines.length > 10 && (
            <div style={{ fontSize: 12, color: '#94a3b8', paddingTop: 6, textAlign: 'center' }}>
              … 还有 {importLines.length - 10} 条
            </div>
          )}
        </div>
      </Modal>
    </div>
  );

  const tabReview = isAdmin && (
    <div>
      {/* 统计条 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        {[
          { label: '全部',   value: annStats.total,    color: '#6366f1' },
          { label: '待审核', value: annStats.pending,  color: '#d97706' },
          { label: '已通过', value: annStats.approved, color: '#059669' },
          { label: '已拒绝', value: annStats.rejected, color: '#dc2626' },
        ].map(({ label, value, color }) => (
          <Col key={label} xs={12} sm={6}>
            <div className="stat-card">
              <div className="stat-card-label">{label}</div>
              <div className="stat-card-value" style={{ color }}>{value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* 筛选 + 导出工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Space size={4}>
          {[
            { key: 'all',      label: '全部' },
            { key: 'pending',  label: '待审核' },
            { key: 'approved', label: '已通过' },
            { key: 'rejected', label: '已拒绝' },
          ].map(({ key, label }) => (
            <Button
              key={key} size="small"
              type={reviewFilter === key ? 'primary' : 'default'}
              onClick={() => { setReviewFilter(key); setSelectedRowKeys([]); }}
            >
              {label}{key !== 'all' && annStats[key] > 0 ? ` (${annStats[key]})` : ''}
            </Button>
          ))}
        </Space>
        <Space>
          <Button icon={<DownloadOutlined />} size="small" onClick={() => handleExport('csv')}>导出 CSV</Button>
          <Button icon={<DownloadOutlined />} size="small" type="primary" onClick={() => handleExport('json')}>导出 JSON</Button>
        </Space>
      </div>

      {/* 批量操作栏 */}
      {selectedRowKeys.length > 0 && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
          padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: 13, color: '#1d4ed8', fontWeight: 600 }}>已选 {selectedRowKeys.length} 条</span>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            style={{ background: '#10b981', borderColor: '#10b981' }}
            loading={reviewLoading} onClick={() => handleBatchReview('approved')}>批量通过</Button>
          <Button size="small" danger icon={<CloseOutlined />}
            loading={reviewLoading} onClick={() => handleBatchReview('rejected')}>批量拒绝</Button>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}

      {/* 表格 */}
      <div className="surface" style={{ overflow: 'hidden' }}>
        <Table
          rowKey="_id"
          dataSource={filteredAnnotations}
          columns={reviewColumns}
          loading={loadingAnnotations || reviewLoading}
          bordered={false}
          size="middle"
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (record) => ({ disabled: !record.fromLLM }),
          }}
        />
      </div>
    </div>
  );

  const tabDistill = isAdmin && (
    <div style={{ paddingTop: 8 }}>
      {metrics ? (() => {
        // 与标签分布保持一致的颜色映射
        const labelColorMap = Object.fromEntries(
          (metrics.labelDistribution || []).map((item, i) => [item._id, LABEL_COLORS[i % LABEL_COLORS.length]])
        );
        const labelColor = (key) => labelColorMap[key] || '#94a3b8';
        return (
        <>
          {/* ── Section 1: 数据概览 ── */}
          <div style={{ marginBottom: 24 }}>
            <SectionLabel>数据概览</SectionLabel>
            <Row gutter={[14, 12]}>
              {[
                { label: '总标注数',   value: metrics.totalAnnotations, icon: <AuditOutlined />,       color: '#6366f1', bg: '#eef2ff' },
                { label: 'LLM 预标注', value: metrics.llmAnnotations,   icon: <RobotOutlined />,       color: '#8b5cf6', bg: '#f5f3ff' },
                { label: '人工标注',   value: metrics.humanAnnotations,  icon: <CheckCircleOutlined />, color: '#10b981', bg: '#ecfdf5' },
                metrics.isNerTask ? {
                  label: '模型状态',
                  value: metrics.nerModelExists ? 'NER词典' : '未训练',
                  icon: metrics.nerModelExists ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
                  color: metrics.nerModelExists ? '#10b981' : '#ef4444',
                  bg:    metrics.nerModelExists ? '#ecfdf5' : '#fef2f2',
                } : {
                  label: '模型状态',
                  value: metrics.advancedLiteModelExists ? '高级·轻量'
                    : metrics.advancedModelExists ? '高级模式'
                    : metrics.simpleModelExists ? '简单模式' : '未训练',
                  icon: (metrics.simpleModelExists || metrics.advancedModelExists || metrics.advancedLiteModelExists)
                    ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
                  color: (metrics.simpleModelExists || metrics.advancedModelExists || metrics.advancedLiteModelExists) ? '#10b981' : '#ef4444',
                  bg:    (metrics.simpleModelExists || metrics.advancedModelExists || metrics.advancedLiteModelExists) ? '#ecfdf5' : '#fef2f2',
                },
              ].map(({ label, value, icon, color, bg }) => (
                <Col xs={24} sm={12} md={6} key={label}>
                  <div className="stat-card">
                    <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
                    <div>
                      <div className="stat-card-label">{label}</div>
                      <div className="stat-card-value" style={{ fontSize: typeof value === 'string' ? 15 : 24 }}>{value}</div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>

          {/* ── NER Section 2: 实体词典模型指标 ── */}
          {metrics.isNerTask && metrics.nerMetrics && (() => {
            const nm = metrics.nerMetrics;
            const f1Color = (v) => v >= 0.7 ? '#10b981' : v >= 0.5 ? '#f59e0b' : '#ef4444';
            return (
              <>
                {/* F1 概览卡片 */}
                <div style={{ marginBottom: 24 }}>
                  <SectionLabel>NER 模型指标</SectionLabel>
                  <Row gutter={[14, 12]}>
                    {[
                      { label: '实体词典大小', value: nm.n_unique_entities, color: '#6366f1', bg: '#eef2ff' },
                      { label: '整体 F1',      value: nm.overall_f1 != null ? (nm.overall_f1 * 100).toFixed(1) + '%' : '—', color: f1Color(nm.overall_f1 || 0), bg: '#f8fafc' },
                      { label: '整体精确率',   value: nm.overall_precision != null ? (nm.overall_precision * 100).toFixed(1) + '%' : '—', color: '#8b5cf6', bg: '#f5f3ff' },
                      { label: '整体召回率',   value: nm.overall_recall != null ? (nm.overall_recall * 100).toFixed(1) + '%' : '—', color: '#06b6d4', bg: '#ecfeff' },
                    ].map(({ label, value, color, bg }) => (
                      <Col xs={24} sm={12} md={6} key={label}>
                        <div className="stat-card">
                          <div className="stat-card-icon" style={{ background: bg, color }}>
                            <ExperimentOutlined />
                          </div>
                          <div>
                            <div className="stat-card-label">{label}</div>
                            <div className="stat-card-value" style={{ fontSize: typeof value === 'string' && value.includes('%') ? 20 : 24 }}>{value}</div>
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </div>

                {/* 各实体类型 P/R/F1 卡片 */}
                {nm.entity_stats && Object.keys(nm.entity_stats).length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <SectionLabel>各实体类型指标</SectionLabel>
                    <Row gutter={[14, 12]}>
                      {Object.entries(nm.entity_stats).map(([label, info], i) => {
                        const lcolor = LABEL_COLORS[i % LABEL_COLORS.length];
                        const f1v = info.f1 || 0;
                        const fc = f1Color(f1v);
                        return (
                          <Col xs={24} sm={12} md={8} key={label}>
                            <div style={{
                              background: '#f8fafc', borderRadius: 8, padding: '16px 18px',
                              border: '1px solid #e2e8f0',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <Tag style={{
                                  borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px', margin: 0,
                                  background: lcolor + '18', border: `1px solid ${lcolor}40`, color: lcolor,
                                }}>{label}</Tag>
                                <span style={{ fontSize: 22, fontWeight: 800, color: fc, lineHeight: 1 }}>
                                  {(f1v * 100).toFixed(1)}%
                                </span>
                              </div>
                              <Progress percent={Math.round(f1v * 100)} showInfo={false} strokeColor={fc} strokeWidth={6} style={{ marginBottom: 10 }} />
                              <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                                <span style={{ color: '#94a3b8' }}>精确率 <strong style={{ color: '#6366f1' }}>{(info.precision * 100).toFixed(0)}%</strong></span>
                                <span style={{ color: '#94a3b8' }}>召回率 <strong style={{ color: '#06b6d4' }}>{(info.recall * 100).toFixed(0)}%</strong></span>
                                <span style={{ color: '#94a3b8' }}>词典 <strong style={{ color: '#64748b' }}>{info.count}个</strong></span>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── NER Section: 实体类型分布（如未训练也显示） ── */}
          {metrics.isNerTask && !metrics.nerMetrics && (
            <div style={{ marginBottom: 24 }}>
              <div className="surface" style={{ padding: '32px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🏷️</div>
                <div style={{ fontSize: 14, color: '#64748b', marginBottom: 8 }}>尚未训练 NER 蒸馏模型</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  请先完成 LLM 预标注并审核，然后点击"触发蒸馏训练"构建实体词典模型。
                </div>
              </div>
            </div>
          )}

          {/* ── Section 2: 准确率摘要（单卡合并展示，仅分类任务） ── */}
          {!metrics.isNerTask && metrics.advancedMetrics && (() => {
            const testAcc  = metrics.advancedMetrics.test_accuracy;
            const trainAcc = metrics.advancedMetrics.train_accuracy;
            const nFeats   = metrics.advancedMetrics.n_features;
            const nTrain   = metrics.advancedMetrics.n_train;
            const nTest    = metrics.advancedMetrics.n_test;
            const overfitInfo = testAcc && trainAcc ? (
              testAcc >= trainAcc * 0.95
                ? { text: '泛化能力良好',   color: '#059669', bg: '#ecfdf5', border: '#6ee7b7', icon: '✓' }
                : testAcc >= trainAcc * 0.85
                ? { text: '可能轻微过拟合', color: '#d97706', bg: '#fffbeb', border: '#fcd34d', icon: '⚠' }
                : { text: '可能存在过拟合', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '✗' }
            ) : null;
            return (
              <div style={{ marginBottom: 24 }}>
                <SectionLabel>准确率摘要</SectionLabel>
                <div className="surface" style={{ padding: '24px 32px' }}>
                  <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', minHeight: 100 }}>
                    {/* 测试集 */}
                    <div style={{ flex: 1, textAlign: 'center', paddingRight: 32, borderRight: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>测试集准确率</div>
                      <div style={{ fontSize: 52, fontWeight: 800, color: accuracyColor(testAcc), lineHeight: 1, marginBottom: 14 }}>
                        {testAcc ? (testAcc * 100).toFixed(1) + '%' : '—'}
                      </div>
                      {testAcc && <Progress percent={Math.round(testAcc * 100)} showInfo={false} strokeColor={accuracyColor(testAcc)} strokeWidth={7} />}
                    </div>
                    {/* 训练集 */}
                    <div style={{ flex: 1, textAlign: 'center', padding: '0 32px', borderRight: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>训练集准确率</div>
                      <div style={{ fontSize: 52, fontWeight: 800, color: '#6366f1', lineHeight: 1, marginBottom: 14 }}>
                        {trainAcc ? (trainAcc * 100).toFixed(1) + '%' : '—'}
                      </div>
                      {trainAcc && <Progress percent={Math.round(trainAcc * 100)} showInfo={false} strokeColor="#6366f1" strokeWidth={7} />}
                    </div>
                    {/* 模型参数 */}
                    <div style={{ flex: 1, paddingLeft: 32 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>模型参数</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {[
                          { k: '特征维度', v: nFeats ? `${nFeats} 维` : '—', color: '#8b5cf6' },
                          { k: '训练样本', v: nTrain ? `${nTrain} 条` : '—', color: '#6366f1' },
                          { k: '测试样本', v: nTest  ? `${nTest} 条`  : '—', color: '#10b981' },
                        ].map(({ k, v, color }) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, color: '#64748b' }}>{k}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color }}>{v}</span>
                          </div>
                        ))}
                        {overfitInfo && (
                          <div style={{
                            marginTop: 6, padding: '5px 10px', borderRadius: 6, fontSize: 12,
                            background: overfitInfo.bg, color: overfitInfo.color, border: `1px solid ${overfitInfo.border}`,
                          }}>
                            {overfitInfo.icon} {overfitInfo.text}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Macro F1 / Precision / Recall + 混淆矩阵 ── */}
          {!metrics.isNerTask && metrics.advancedMetrics?.macro_f1 != null && (() => {
            const am = metrics.advancedMetrics;
            const macroCards = [
              { label: 'Macro F1',        value: am.macro_f1,        color: '#0ea5e9' },
              { label: 'Macro Precision', value: am.macro_precision, color: '#8b5cf6' },
              { label: 'Macro Recall',    value: am.macro_recall,    color: '#10b981' },
            ];
            const cm = am.confusion_matrix;
            const labelKeys = am.label_metrics ? Object.keys(am.label_metrics) : Object.keys(am.label_accuracies || {});
            const cmMax = cm ? Math.max(...cm.flat()) : 1;
            return (
              <div style={{ marginBottom: 24 }}>
                <SectionLabel>综合评估指标</SectionLabel>
                {/* Macro 指标卡片 */}
                <Row gutter={[12, 12]} style={{ marginBottom: cm ? 16 : 0 }}>
                  {macroCards.map(({ label, value, color }) => (
                    <Col xs={24} sm={8} key={label}>
                      <div className="surface" style={{ padding: '16px 20px', textAlign: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 38, fontWeight: 800, color, lineHeight: 1, marginBottom: 10 }}>
                          {value != null ? (value * 100).toFixed(1) + '%' : '—'}
                        </div>
                        {value != null && <Progress percent={Math.round(value * 100)} showInfo={false} strokeColor={color} strokeWidth={6} />}
                      </div>
                    </Col>
                  ))}
                </Row>
                {/* Per-label P/R/F1 表格 */}
                {am.label_metrics && (
                  <div className="surface" style={{ padding: '16px 20px', marginBottom: cm ? 16 : 0, overflowX: 'auto' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>各类别详细指标</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                          {['类别', 'Precision', 'Recall', 'F1', 'Support', 'TP', 'FP', 'FN'].map(h => (
                            <th key={h} style={{ padding: '4px 10px', textAlign: h === '类别' ? 'left' : 'right', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(am.label_metrics).map(([lbl, m]) => (
                          <tr key={lbl} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b' }}>{lbl}</td>
                            {[m.precision, m.recall, m.f1].map((v, i) => (
                              <td key={i} style={{ padding: '6px 10px', textAlign: 'right', color: v >= 0.7 ? '#059669' : v >= 0.5 ? '#d97706' : '#dc2626', fontWeight: 600 }}>
                                {(v * 100).toFixed(1)}%
                              </td>
                            ))}
                            {[m.support, m.tp, m.fp, m.fn].map((v, i) => (
                              <td key={i} style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b' }}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* 混淆矩阵 */}
                {cm && labelKeys.length > 0 && (
                  <div className="surface" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 12 }}>混淆矩阵（行=真实，列=预测）</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '4px 8px', color: '#94a3b8' }}>真实\预测</th>
                            {labelKeys.map(l => (
                              <th key={l} style={{ padding: '4px 12px', color: '#475569', fontWeight: 600, textAlign: 'center' }}>{l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cm.map((row, ri) => (
                            <tr key={ri}>
                              <td style={{ padding: '4px 8px', fontWeight: 600, color: '#475569' }}>{labelKeys[ri]}</td>
                              {row.map((val, ci) => {
                                const intensity = cmMax > 0 ? val / cmMax : 0;
                                const isDiag = ri === ci;
                                const bg = isDiag
                                  ? `rgba(14,165,233,${0.15 + intensity * 0.7})`
                                  : `rgba(239,68,68,${intensity * 0.5})`;
                                const textColor = intensity > 0.6 ? '#fff' : (isDiag ? '#0369a1' : '#991b1b');
                                return (
                                  <td key={ci} style={{
                                    padding: '8px 16px', textAlign: 'center', fontWeight: isDiag ? 700 : 400,
                                    background: bg, color: textColor, border: '1px solid #f1f5f9', borderRadius: 4,
                                  }}>{val}</td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Section 3: 标签/实体分布 + 趋势折线图（等高双栏） ── */}
          {metrics.labelDistribution?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>{metrics.isNerTask ? '实体类型分布' : '数据分布与训练趋势'}</SectionLabel>
              <Row gutter={[14, 14]}>
                <Col xs={24} md={metrics.isNerTask ? 24 : 9}>
                  <div className="surface" style={{ padding: '20px 22px', height: '100%' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 16 }}>
                      {metrics.isNerTask ? '实体类型标注数量' : '标签分布'}
                    </div>
                    {metrics.labelDistribution.map((item, i) => {
                      const pct = Math.round((item.count / metrics.totalAnnotations) * 100);
                      const color = LABEL_COLORS[i % LABEL_COLORS.length];
                      return (
                        <div key={item._id} style={{ marginBottom: 13 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <Tag style={{
                              borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px',
                              background: color + '18', border: `1px solid ${color}40`, color, margin: 0,
                            }}>{item._id}</Tag>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>{item.count} 条 · {pct}%</span>
                          </div>
                          <Progress percent={pct} showInfo={false} strokeColor={color} strokeWidth={5} />
                        </div>
                      );
                    })}
                  </div>
                </Col>
                {!metrics.isNerTask && <Col xs={24} md={15}>
                  <div className="surface" style={{ padding: '20px 22px', height: '100%' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 16 }}>
                      {metrics.advancedMetrics?.label_accuracies ? '各类别准确率趋势（模拟）' : '准确率概览'}
                    </div>
                    {metrics.advancedMetrics?.label_accuracies ? (() => {
                      const lineLabels = Object.keys(metrics.advancedMetrics.label_accuracies);
                      const lineColors = lineLabels.map((l) => labelColor(l));
                      return (
                      <Line
                        data={(() => {
                          const iters = Array.from({ length: 10 }, (_, i) => i + 1);
                          const labelAcc = metrics.advancedMetrics.label_accuracies;
                          return iters.flatMap((iter) =>
                            Object.entries(labelAcc).map(([label, info]) => {
                              const finalAcc = info.accuracy || 0;
                              const progress = iter / 10;
                              const acc = Math.max(0, Math.min(1,
                                finalAcc * (0.3 + 0.7 * progress) + (Math.sin(iter * label.length) * 0.04)
                              ));
                              return { iteration: `第${iter}轮`, category: label, accuracy: acc };
                            })
                          );
                        })()}
                        xField="iteration"
                        yField="accuracy"
                        colorField="category"
                        seriesField="category"
                        smooth={true}
                        point={{ size: 3, shape: 'circle' }}
                        legend={{ position: 'bottom' }}
                        yAxis={{ label: { formatter: (v) => `${(v * 100).toFixed(0)}%` }, min: 0, max: 1 }}
                        scale={{ color: { range: lineColors } }}
                        height={230}
                      />
                      );
                    })() : metrics.advancedMetrics ? (
                      <div style={{ paddingTop: 8 }}>
                        {[
                          { label: '训练集准确率', value: metrics.advancedMetrics.train_accuracy, color: '#6366f1' },
                          { label: '测试集准确率', value: metrics.advancedMetrics.test_accuracy,  color: accuracyColor(metrics.advancedMetrics.test_accuracy) },
                        ].map(({ label, value, color }) => (
                          <div key={label} style={{ marginBottom: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</span>
                              <span style={{ fontSize: 15, fontWeight: 700, color }}>{value ? (value * 100).toFixed(2) + '%' : '—'}</span>
                            </div>
                            {value && <Progress percent={Math.round(value * 100)} showInfo={false} strokeColor={color} strokeWidth={7} />}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#94a3b8', fontSize: 13, paddingTop: 12 }}>完成高级蒸馏训练后可查看准确率趋势</div>
                    )}
                  </div>
                </Col>}
              </Row>
            </div>
          )}

          {/* ── Section 4: 各类别准确率卡片（仅分类任务） ── */}
          {!metrics.isNerTask && metrics.advancedMetrics?.label_accuracies && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>各类别准确率详情</SectionLabel>
              <Row gutter={[14, 12]}>
                {Object.entries(metrics.advancedMetrics.label_accuracies).map(([label, info], i) => {
                  const acc = info.accuracy ?? 0;
                  const color = accuracyColor(acc);
                  const pct = (acc * 100).toFixed(1);
                  const lcolor = LABEL_COLORS[i % LABEL_COLORS.length];
                  return (
                    <Col xs={24} sm={12} md={8} key={label}>
                      <div style={{
                        background: '#f8fafc', borderRadius: 8, padding: '16px 18px',
                        border: '1px solid #e2e8f0', height: '100%',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <Tag style={{
                            borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px', margin: 0,
                            background: lcolor + '18', border: `1px solid ${lcolor}40`, color: lcolor,
                          }}>{label}</Tag>
                          <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
                            {info.n_test_samples > 0 ? pct + '%' : '—'}
                          </span>
                        </div>
                        {info.n_test_samples > 0 && (
                          <Progress percent={Math.round(acc * 100)} showInfo={false} strokeColor={color} strokeWidth={6} style={{ marginBottom: 10 }} />
                        )}
                        <div style={{ display: 'flex', gap: 14, fontSize: 12, marginTop: 2 }}>
                          <span style={{ color: '#94a3b8' }}>共 {info.n_test_samples} 条</span>
                          <span style={{ color: '#10b981', fontWeight: 500 }}>✓ {info.n_correct}</span>
                          <span style={{ color: '#ef4444', fontWeight: 500 }}>✗ {info.n_test_samples - info.n_correct}</span>
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            </div>
          )}

          {/* ── Section 5: 对比柱状图（1:2 列宽，仅分类任务） ── */}
          {!metrics.isNerTask && metrics.advancedMetrics?.label_accuracies && (() => {
            const trainAcc = metrics.advancedMetrics.train_accuracy;
            const testAcc  = metrics.advancedMetrics.test_accuracy;
            if (!trainAcc && !testAcc) return null;
            const compareData = [
              { metric: '训练集', value: Math.round((trainAcc || 0) * 100) },
              { metric: '测试集', value: Math.round((testAcc  || 0) * 100) },
            ];
            const barData = Object.entries(metrics.advancedMetrics.label_accuracies).map(([label, info]) => ({
              label, accuracy: Math.round((info.accuracy ?? 0) * 100),
            }));
            const barColors = barData.map(({ label }) => labelColor(label));
            return (
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>准确率对比图</SectionLabel>
                <Row gutter={[14, 14]}>
                  <Col xs={24} md={8}>
                    <div className="surface" style={{ padding: '20px 22px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 14 }}>训练集 vs 测试集</div>
                      <Column
                        data={compareData}
                        xField="metric"
                        yField="value"
                        colorField="metric"
                        scale={{ color: { range: ['#6366f1', accuracyColor(testAcc)] } }}
                        legend={false}
                        label={{ position: 'top', style: { fontWeight: 600, fontSize: 13 }, formatter: (v) => v + '%' }}
                        yAxis={{ label: { formatter: (v) => v + '%' }, max: 100 }}
                        height={190}
                        columnStyle={{ borderRadius: [6, 6, 0, 0] }}
                        columnWidthRatio={0.45}
                      />
                    </div>
                  </Col>
                  <Col xs={24} md={16}>
                    <div className="surface" style={{ padding: '20px 22px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 14 }}>各类别测试准确率</div>
                      <Column
                        data={barData}
                        xField="label"
                        yField="accuracy"
                        colorField="label"
                        scale={{ color: { range: barColors } }}
                        legend={false}
                        label={{ position: 'top', style: { fontWeight: 600, fontSize: 13 }, formatter: (v) => v + '%' }}
                        yAxis={{ label: { formatter: (v) => v + '%' }, max: 100 }}
                        height={190}
                        columnStyle={{ borderRadius: [6, 6, 0, 0] }}
                      />
                    </div>
                  </Col>
                </Row>
              </div>
            );
          })()}
          {/* ── Section 6: 在线推理 ── */}
          {(metrics.nerModelExists || metrics.simpleModelExists || metrics.advancedModelExists || metrics.advancedLiteModelExists) && (
            <div style={{ marginTop: 8 }}>
              <SectionLabel>在线推理测试</SectionLabel>
              <div className="surface" style={{ padding: '20px 24px' }}>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12 }}>
                  输入任意文本，使用已训练的蒸馏模型进行预测：
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextArea
                    value={predictText}
                    onChange={(e) => { setPredictText(e.target.value); setPredictResult(null); }}
                    placeholder={metrics.isNerTask ? '例如：张伟在北京参加了2023年的会议...' : '输入待分类文本...'}
                    rows={2}
                    style={{ flex: '1 1 300px', minWidth: 200 }}
                    onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handlePredict(); } }}
                  />
                  <Button
                    type="primary" icon={<ExperimentOutlined />}
                    loading={predictLoading}
                    onClick={handlePredict}
                    disabled={!predictText.trim()}
                    style={{ fontWeight: 600, background: '#f59e0b', borderColor: '#f59e0b', height: 40 }}
                  >
                    推理
                  </Button>
                </div>

                {/* 推理结果 */}
                {predictResult && (
                  <div style={{ marginTop: 16 }}>
                    {predictResult.type === 'classification' ? (
                      <div>
                        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>预测结果：</span>
                          <Tag style={{
                            borderRadius: 20, fontWeight: 700, fontSize: 13, padding: '2px 12px',
                            background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5',
                          }}>{predictResult.label}</Tag>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>各类别概率：</div>
                        {Object.entries(predictResult.probabilities || {})
                          .sort(([, a], [, b]) => b - a)
                          .map(([label, prob], i) => {
                            const color = LABEL_COLORS[i % LABEL_COLORS.length];
                            const pct = Math.round(prob * 100);
                            return (
                              <div key={label} style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                  <Tag style={{ borderRadius: 20, fontSize: 11, padding: '0 7px', margin: 0,
                                    background: color + '18', border: `1px solid ${color}40`, color }}>{label}</Tag>
                                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                                </div>
                                <Progress percent={pct} showInfo={false} strokeColor={color} strokeWidth={5} />
                              </div>
                            );
                          })}
                      </div>
                    ) : predictResult.type === 'ner' ? (
                      <div>
                        <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginBottom: 10 }}>
                          识别到 <strong style={{ color: '#0f172a' }}>{predictResult.spans?.length || 0}</strong> 个实体：
                        </div>
                        {predictResult.spans?.length > 0 ? (
                          <Space size={[6, 6]} wrap>
                            {predictResult.spans.map((s, i) => {
                              const color = LABEL_COLORS[i % LABEL_COLORS.length];
                              return (
                                <Tag key={i} style={{
                                  borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '2px 10px',
                                  background: color + '18', border: `1px solid ${color}40`, color,
                                }}>
                                  <span style={{ color: '#64748b', fontWeight: 400, marginRight: 4 }}>{s.label}</span>
                                  {s.text}
                                </Tag>
                              );
                            })}
                          </Space>
                        ) : (
                          <span style={{ fontSize: 13, color: '#94a3b8' }}>未识别到实体</span>
                        )}
                        {/* 高亮文本 */}
                        {predictResult.spans?.length > 0 && (
                          <div style={{
                            marginTop: 12, padding: '10px 14px', background: '#f8fafc',
                            borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, lineHeight: 2,
                          }}>
                            {(() => {
                              const text = predictText;
                              const spans = [...(predictResult.spans || [])].sort((a, b) => a.start - b.start);
                              const parts = [];
                              let cursor = 0;
                              spans.forEach((s, i) => {
                                if (s.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
                                const color = LABEL_COLORS[i % LABEL_COLORS.length];
                                parts.push(
                                  <mark key={`s${i}`} style={{
                                    background: color + '30', borderBottom: `2px solid ${color}`,
                                    borderRadius: 3, padding: '0 2px',
                                  }}>
                                    {s.text}
                                    <sup style={{ fontSize: 10, color, fontWeight: 700, marginLeft: 2 }}>{s.label}</sup>
                                  </mark>
                                );
                                cursor = s.end;
                              });
                              if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
                              return parts;
                            })()}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
        );
      })() : (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>正在加载指标数据…</div>
      )}
    </div>
  );

  const tabItems = [
    { key: 'info',    label: <span><FileTextOutlined style={{ marginRight: 6 }} />任务信息</span>,    children: tabInfo },
    ...(isAdmin ? [
      { key: 'samples', label: <span><DotChartOutlined style={{ marginRight: 6 }} />样本管理</span>, children: tabSamples },
      { key: 'review',  label: <span><AuditOutlined style={{ marginRight: 6 }} />数据审核</span>,   children: tabReview },
      { key: 'distill', label: <span><ExperimentOutlined style={{ marginRight: 6 }} />蒸馏效果</span>, children: tabDistill },
    ] : [])
  ];

  return (
    <div>
      {/* 页面顶部 */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Button
            type="text" icon={<ArrowLeftOutlined />} size="small"
            style={{ color: '#64748b', padding: '0 4px' }}
            onClick={() => navigate('/tasks')}
          >
            返回
          </Button>
          <span style={{ color: '#cbd5e1', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13, color: '#64748b' }}>任务管理</span>
          {task && (
            <>
              <span style={{ color: '#cbd5e1', fontSize: 13 }}>/</span>
              <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{task.name}</span>
            </>
          )}
        </div>
        <h1 className="page-title" style={{ marginBottom: 4 }}>任务详情与样本管理</h1>
        <p className="page-subtitle">维护样本数据，触发 LLM 预标注与蒸馏训练</p>
      </div>

      {/* Tabs */}
      <div className="surface" style={{ padding: '0 24px 24px' }}>
        <Tabs
          defaultActiveKey="samples"
          items={tabItems}
          style={{ marginTop: 4 }}
        />
      </div>
    </div>
  );
}

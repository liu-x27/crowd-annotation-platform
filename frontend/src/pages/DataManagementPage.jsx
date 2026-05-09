import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, message, Select, Row, Col } from 'antd';
import { DownloadOutlined, RobotOutlined, UserOutlined, TagsOutlined, BarChartOutlined } from '@ant-design/icons';
import client from '../api/client.js';

const { Option } = Select;

const LABEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const STAT_CARDS = [
  { key: 'total',      label: '总标注数',   icon: <BarChartOutlined />, color: '#6366f1', bg: '#eef2ff' },
  { key: 'llmCount',   label: 'LLM 预标注', icon: <RobotOutlined />,   color: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'humanCount', label: '人工标注',   icon: <UserOutlined />,    color: '#10b981', bg: '#ecfdf5' },
];

export default function DataManagementPage() {
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const fetchTasks = async () => {
    try {
      const { data } = await client.get('/tasks');
      setTasks(data);
      if (data.length > 0 && !selectedTaskId) setSelectedTaskId(data[0]._id);
    } catch { message.error('加载任务失败'); }
  };

  const fetchAnnotations = async (taskId) => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [{ data: annData }, { data: sampleData }] = await Promise.all([
        client.get(`/annotations/task/${taskId}`),
        client.get(`/tasks/${taskId}/samples`, { params: { page: 1, pageSize: 1000 } }),
      ]);
      const merged = annData.map((ann) => {
        const sample = sampleData.items?.find((s) => s._id === ann.sampleId);
        return { ...ann, content: sample?.content || '-' };
      });
      setAnnotations(merged);

      const total = merged.length;
      const llmCount = merged.filter((a) => a.fromLLM).length;
      const humanCount = total - llmCount;

      // 标签分布：文本分类用 label，NER 用 spans 里的 label 统计
      const labelDist = {};
      merged.forEach((a) => {
        if (a.spans && a.spans.length > 0) {
          a.spans.forEach((s) => {
            if (s.label) labelDist[s.label] = (labelDist[s.label] || 0) + 1;
          });
        } else if (a.label) {
          labelDist[a.label] = (labelDist[a.label] || 0) + 1;
        }
      });
      setStats({
        total, llmCount, humanCount,
        labelDistribution: Object.entries(labelDist).map(([label, count]) => ({ label, count })),
      });
    } catch { message.error('加载标注数据失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTasks(); }, []);
  useEffect(() => { if (selectedTaskId) fetchAnnotations(selectedTaskId); }, [selectedTaskId]);

  const handleExport = async (format) => {
    if (!selectedTaskId) { message.warning('请先选择任务'); return; }
    try {
      const response = await client.get(`/annotations/task/${selectedTaskId}/export`, {
        params: { format },
        responseType: format === 'csv' ? 'blob' : 'json',
      });
      const isCSV = format === 'csv';
      const blob = isCSV
        ? new Blob([response.data], { type: 'text/csv' })
        : new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `annotations_${selectedTaskId}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      message.success(`导出 ${format.toUpperCase()} 成功`);
    } catch { message.error('导出失败'); }
  };

  const selectedTask = tasks.find((t) => t._id === selectedTaskId);
  const isNerTask = selectedTask?.type === 'ner';

  const columns = [
    {
      title: '样本文本',
      dataIndex: 'content',
      ellipsis: true,
      render: (t) => <span style={{ color: '#334155', fontSize: 13 }}>{t}</span>
    },
    {
      title: isNerTask ? '实体标注' : '标签',
      width: isNerTask ? 240 : 120,
      render: (_, record) => {
        if (isNerTask) {
          const spans = record.spans || [];
          if (spans.length === 0) return <span style={{ color: '#cbd5e1', fontSize: 12 }}>暂无实体</span>;
          return (
            <Space size={[4, 4]} wrap>
              {spans.slice(0, 4).map((s, i) => (
                <Tag key={i} style={{
                  borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '1px 7px',
                  background: LABEL_COLORS[i % LABEL_COLORS.length] + '20',
                  border: `1px solid ${LABEL_COLORS[i % LABEL_COLORS.length]}50`,
                  color: LABEL_COLORS[i % LABEL_COLORS.length],
                }}>
                  {s.label}: {s.text}
                </Tag>
              ))}
              {spans.length > 4 && <span style={{ fontSize: 11, color: '#94a3b8' }}>+{spans.length - 4}</span>}
            </Space>
          );
        }
        return record.label
          ? <Tag style={{ borderRadius: 20, fontWeight: 600, fontSize: 12, padding: '1px 8px' }} color="purple">{record.label}</Tag>
          : <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>;
      }
    },
    {
      title: '来源',
      dataIndex: 'fromLLM',
      width: 110,
      render: (fromLLM) => (
        <Tag
          icon={fromLLM ? <RobotOutlined /> : <UserOutlined />}
          style={{
            borderRadius: 20, fontWeight: 500, fontSize: 12, padding: '1px 8px',
            background: fromLLM ? '#f5f3ff' : '#ecfdf5',
            border: `1px solid ${fromLLM ? '#c4b5fd' : '#6ee7b7'}`,
            color: fromLLM ? '#7c3aed' : '#059669',
          }}
        >
          {fromLLM ? 'LLM' : '人工'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 155,
      render: (v) => (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {v ? new Date(v).toLocaleString('zh-CN') : '-'}
        </span>
      )
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">数据管理</h1>
            <p className="page-subtitle">查看所有标注记录并导出训练数据</p>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => handleExport('csv')}>导出 CSV</Button>
            <Button icon={<DownloadOutlined />} type="primary" onClick={() => handleExport('json')}>导出 JSON</Button>
          </Space>
        </div>
      </div>

      {/* 任务选择器 */}
      <div className="surface" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#475569', flexShrink: 0 }}>当前任务：</span>
        <Select
          style={{ width: 320 }}
          value={selectedTaskId}
          onChange={setSelectedTaskId}
          placeholder="选择任务"
          size="middle"
        >
          {tasks.map((task) => (
            <Option key={task._id} value={task._id}>
              {task.name}
              {task.type === 'ner' && (
                <Tag size="small" style={{ marginLeft: 6, fontSize: 10, borderRadius: 10,
                  background: '#ecfeff', border: '1px solid #a5f3fc', color: '#0891b2', padding: '0 5px' }}>
                  NER
                </Tag>
              )}
            </Option>
          ))}
        </Select>
        {isNerTask && (
          <Tag style={{ borderRadius: 20, fontSize: 11, background: '#ecfeff', border: '1px solid #a5f3fc', color: '#0891b2', fontWeight: 600 }}>
            命名实体识别任务
          </Tag>
        )}
      </div>

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          {STAT_CARDS.map(({ key, label, icon, color, bg }) => (
            <Col xs={24} sm={8} key={key}>
              <div className="stat-card" style={{ marginBottom: 0 }}>
                <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
                <div>
                  <div className="stat-card-label">{label}</div>
                  <div className="stat-card-value">{stats[key]}</div>
                </div>
              </div>
            </Col>
          ))}
          {stats.labelDistribution.length > 0 && (
            <Col xs={24} style={{ marginTop: 12 }}>
              <div className="surface" style={{ padding: '14px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
                    {isNerTask ? '实体分布' : '标签分布'}
                  </span>
                  {stats.labelDistribution.map(({ label, count }, i) => (
                    <Tag key={label} style={{
                      borderRadius: 20, fontSize: 12, fontWeight: 600, padding: '2px 10px',
                      background: LABEL_COLORS[i % LABEL_COLORS.length] + '18',
                      border: `1px solid ${LABEL_COLORS[i % LABEL_COLORS.length]}40`,
                      color: LABEL_COLORS[i % LABEL_COLORS.length],
                    }}>
                      {label}: {count}
                    </Tag>
                  ))}
                </div>
              </div>
            </Col>
          )}
        </Row>
      )}

      {/* 标注数据表格 */}
      <div className="surface" style={{ overflow: 'hidden' }}>
        <Table
          rowKey="_id"
          dataSource={annotations}
          columns={columns}
          loading={loading}
          bordered={false}
          size="middle"
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>
    </div>
  );
}

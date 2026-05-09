import React, { useEffect, useState, useMemo } from 'react';
import {
  Table, Tag, Avatar, Row, Col, Spin, message, Progress,
  Button, Modal, Checkbox, Space, Input, Tooltip, Empty, InputNumber,
} from 'antd';
import {
  UserOutlined, TeamOutlined, RobotOutlined, TrophyOutlined,
  ProjectOutlined, SearchOutlined, CheckSquareOutlined, BorderOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import client from '../api/client.js';

const ROLE_COLOR = { admin: '#6366f1', annotator: '#10b981' };
const TYPE_COLOR = { text_classification: '#6366f1', ner: '#f59e0b' };
const TYPE_LABEL = { text_classification: '分类', ner: 'NER' };
const MEDAL      = ['🥇', '🥈', '🥉'];

export default function AnnotatorPage() {
  const [users,   setUsers]   = useState([]);
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  // 任务分配 Modal
  const [assignModal,  setAssignModal]  = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);   // { _id, username }
  const [saving,       setSaving]       = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // taskAssignments: { [taskId]: { checked: bool, from: number|'', to: number|'', totalCount: number } }
  const [taskAssignments, setTaskAssignments] = useState({});

  /* ── 数据加载 ── */
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [{ data: userData }, { data: taskData }] = await Promise.all([
        client.get('/users/contributions'),
        client.get('/tasks'),
      ]);
      setUsers(userData || []);
      setTasks(taskData || []);
    } catch (err) {
      message.error(err.response?.data?.error || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  /* ── 派生数据 ── */
  const totalAnnotations = users.reduce((s, u) => s + (u.annotationCount || 0), 0);
  const annotators       = useMemo(() => users.filter((u) => u.role === 'annotator'), [users]);
  const admins           = useMemo(() => users.filter((u) => u.role === 'admin'),     [users]);
  const topAnnotator     = annotators.length > 0 ? annotators[0] : null;

  /* ── 任务分配 Modal 操作 ── */
  const openAssignModal = async (user) => {
    setAssignTarget(user);
    setTaskSearch('');
    setAssignModal(true);
    setLoadingAssignments(true);

    try {
      const { data: existingAssignments } = await client.get(`/users/${user._id}/assignments`);
      // existingAssignments: [{ taskId, taskName, taskType, assignedCount, totalCount }]
      const assignMap = {};
      for (const a of existingAssignments) {
        assignMap[a.taskId?.toString()] = a;
      }

      const init = {};
      for (const t of tasks) {
        const key      = t._id.toString();
        const existing = assignMap[key];
        init[key] = existing
          ? { checked: true,  from: 1, to: existing.assignedCount, totalCount: existing.totalCount || t.sampleCount || 0 }
          : { checked: false, from: 1, to: '',                     totalCount: t.sampleCount || 0 };
      }
      setTaskAssignments(init);
    } catch {
      // fallback: all unchecked
      const init = {};
      for (const t of tasks) {
        init[t._id.toString()] = { checked: false, from: 1, to: '', totalCount: t.sampleCount || 0 };
      }
      setTaskAssignments(init);
    } finally {
      setLoadingAssignments(false);
    }
  };

  const handleSaveAssign = async () => {
    if (!assignTarget) return;
    setSaving(true);
    try {
      const assignments = Object.entries(taskAssignments)
        .filter(([, v]) => v.checked && v.from && v.to)
        .map(([taskId, v]) => ({ taskId, from: Number(v.from), to: Number(v.to) }));

      await client.put(`/users/${assignTarget._id}/assignments`, { assignments });
      message.success(`已为 ${assignTarget.username} 更新任务分配`);
      setAssignModal(false);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateAssignment = (taskId, patch) => {
    setTaskAssignments((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], ...patch },
    }));
  };

  const filteredTasks = useMemo(
    () => tasks.filter((t) => !taskSearch || t.name.toLowerCase().includes(taskSearch.toLowerCase())),
    [tasks, taskSearch]
  );

  const checkedCount = Object.values(taskAssignments).filter((v) => v.checked).length;

  /* ── 贡献排行榜列 ── */
  const columns = [
    {
      title: '排名', width: 60, align: 'center',
      render: (_, __, i) => MEDAL[i]
        ? <span style={{ fontSize: 18 }}>{MEDAL[i]}</span>
        : <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>#{i + 1}</span>,
    },
    {
      title: '标注员', dataIndex: 'username',
      render: (name, record) => {
        const color  = ROLE_COLOR[record.role] || '#64748b';
        const letter = (name || '?')[0].toUpperCase();
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={32} style={{ background: color, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              {letter}
            </Avatar>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: '#0f172a' }}>{name}</div>
              <Tag style={{
                borderRadius: 20, fontSize: 11, fontWeight: 500, padding: '0 6px', lineHeight: '16px',
                background: color + '18', border: `1px solid ${color}40`, color, margin: 0,
              }}>
                {record.role === 'admin' ? '管理员' : '标注员'}
              </Tag>
            </div>
          </div>
        );
      },
    },
    {
      title: '标注数量', dataIndex: 'annotationCount',
      sorter: (a, b) => a.annotationCount - b.annotationCount,
      defaultSortOrder: 'descend',
      render: (count) => (
        <span style={{ fontSize: 16, fontWeight: 700, color: count > 0 ? '#0f172a' : '#94a3b8' }}>
          {count}
        </span>
      ),
    },
    {
      title: '贡献占比', dataIndex: 'annotationCount',
      render: (count) => {
        const pct   = totalAnnotations > 0 ? Math.round((count / totalAnnotations) * 100) : 0;
        const color = pct >= 30 ? '#6366f1' : pct >= 10 ? '#10b981' : '#94a3b8';
        return (
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 3 }}>{pct}%</div>
            <Progress percent={pct} showInfo={false} strokeColor={color} strokeWidth={5} style={{ margin: 0 }} />
          </div>
        );
      },
    },
    {
      title: '已分配样本',
      render: (_, record) => {
        const tc = record.assignedTaskCount  || 0;
        const sc = record.assignedSampleCount || 0;
        if (tc === 0) return <span style={{ fontSize: 12, color: '#94a3b8' }}>未分配（全部可见）</span>;
        return (
          <div style={{ fontSize: 12 }}>
            <span style={{ color: '#6366f1', fontWeight: 700 }}>{tc}</span>
            <span style={{ color: '#64748b' }}> 个任务 / </span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>{sc}</span>
            <span style={{ color: '#64748b' }}> 条样本</span>
          </div>
        );
      },
    },
    {
      title: '操作', width: 120, align: 'center',
      render: (_, record) => record.role === 'annotator' ? (
        <Button
          size="small"
          type="primary"
          icon={<ProjectOutlined />}
          onClick={() => openAssignModal(record)}
          style={{ fontWeight: 600, fontSize: 12 }}
        >
          分配任务
        </Button>
      ) : (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>管理员</span>
      ),
    },
    {
      title: '加入时间', dataIndex: 'createdAt', width: 110,
      render: (v) => (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {v ? new Date(v).toLocaleDateString('zh-CN') : '—'}
        </span>
      ),
    },
  ];

  /* ── 渲染 ── */
  return (
    <div>
      {/* 页面标题 */}
      <div className="page-header">
        <h1 className="page-title">标注员管理</h1>
        <p className="page-subtitle">查看标注贡献统计，为标注员分配专属任务与样本范围</p>
      </div>

      {/* 概览卡片 */}
      <Row gutter={[14, 14]} style={{ marginBottom: 20 }}>
        {[
          { title: '总标注量',   value: totalAnnotations, icon: <RobotOutlined />,   color: '#6366f1', bg: '#eef2ff' },
          { title: '标注员人数', value: annotators.length, icon: <TeamOutlined />,   color: '#10b981', bg: '#ecfdf5' },
          { title: '管理员人数', value: admins.length,     icon: <UserOutlined />,   color: '#8b5cf6', bg: '#f5f3ff' },
          { title: '贡献最多',   value: topAnnotator ? topAnnotator.username : '—', icon: <TrophyOutlined />, color: '#f59e0b', bg: '#fffbeb' },
        ].map(({ title, value, icon, color, bg }) => (
          <Col xs={24} sm={12} md={6} key={title}>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
              <div>
                <div className="stat-card-label">{title}</div>
                <div className="stat-card-value" style={{ fontSize: typeof value === 'string' ? 16 : 24 }}>
                  {value}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* 贡献排行榜 */}
      <div className="surface" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>贡献排行榜 &amp; 任务分配</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            按人工标注数量排序；点击"分配任务"为标注员指定专属任务和样本范围
          </div>
        </div>
        <Spin spinning={loading}>
          <Table
            rowKey="_id"
            dataSource={users}
            columns={columns}
            loading={false}
            bordered={false}
            size="middle"
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 人` }}
            locale={{ emptyText: '暂无数据' }}
          />
        </Spin>
      </div>

      {/* ── 任务分配 Modal ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={28} style={{ background: '#10b981', fontSize: 12, fontWeight: 700 }}>
              {assignTarget ? (assignTarget.username || '?')[0].toUpperCase() : '?'}
            </Avatar>
            <span>为 <strong>{assignTarget?.username}</strong> 分配任务与样本范围</span>
          </div>
        }
        open={assignModal}
        onOk={handleSaveAssign}
        onCancel={() => setAssignModal(false)}
        confirmLoading={saving}
        okText="保存分配"
        cancelText="取消"
        width={600}
        styles={{ body: { maxHeight: 600, display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        {/* 说明 + 全选/清空 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            勾选任务并设置样本范围（第 N 条 ~ 第 M 条，按添加时间排序）。
            <br />
            <span style={{ color: '#94a3b8' }}>
              已勾选 <strong style={{ color: '#6366f1' }}>{checkedCount}</strong> 个任务。留空 = 取消所有分配（公开任务对全员可见）。
            </span>
          </span>
          <Space size={6}>
            <Button
              size="small"
              icon={<CheckSquareOutlined />}
              onClick={() => setTaskAssignments((prev) => {
                const next = { ...prev };
                for (const t of tasks) {
                  const key = t._id.toString();
                  next[key] = { ...next[key], checked: true,
                    from: next[key]?.from || 1,
                    to:   next[key]?.to   || (next[key]?.totalCount || ''),
                  };
                }
                return next;
              })}
              style={{ fontSize: 12 }}
            >
              全选
            </Button>
            <Button
              size="small"
              icon={<BorderOutlined />}
              onClick={() => setTaskAssignments((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) next[key] = { ...next[key], checked: false };
                return next;
              })}
              style={{ fontSize: 12 }}
            >
              清空
            </Button>
          </Space>
        </div>

        {/* 搜索框 */}
        <Input
          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
          placeholder="搜索任务名称..."
          value={taskSearch}
          onChange={(e) => setTaskSearch(e.target.value)}
          size="small"
          allowClear
        />

        {/* 任务列表 */}
        <div style={{
          flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8,
          maxHeight: 420,
        }}>
          {loadingAssignments ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
          ) : filteredTasks.length === 0 ? (
            <Empty description="暂无任务" style={{ padding: 32 }} />
          ) : (
            filteredTasks.map((task, i) => {
              const key        = task._id.toString();
              const assignment = taskAssignments[key] || { checked: false, from: 1, to: '', totalCount: 0 };
              const typeColor  = TYPE_COLOR[task.type] || '#94a3b8';
              const total      = assignment.totalCount || task.sampleCount || 0;

              return (
                <div
                  key={task._id}
                  style={{
                    borderBottom: i < filteredTasks.length - 1 ? '1px solid #f1f5f9' : 'none',
                    background:   assignment.checked ? '#f8f7ff' : 'transparent',
                    transition:   'background 0.15s',
                  }}
                >
                  {/* 任务行 */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}
                    onClick={() => updateAssignment(key, { checked: !assignment.checked })}
                  >
                    <Checkbox
                      checked={assignment.checked}
                      onChange={() => updateAssignment(key, { checked: !assignment.checked })}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{task.name}</div>
                      {task.description && (
                        <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.description}
                        </div>
                      )}
                    </div>
                    <Tag style={{
                      borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '0 8px', flexShrink: 0,
                      background: typeColor + '18', border: `1px solid ${typeColor}40`, color: typeColor,
                    }}>
                      {TYPE_LABEL[task.type] || task.type}
                    </Tag>
                    {total > 0 && (
                      <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>
                        <DatabaseOutlined style={{ marginRight: 3 }} />{total} 条
                      </span>
                    )}
                  </div>

                  {/* 范围行（仅勾选时展开） */}
                  {assignment.checked && (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        padding: '0 16px 10px 42px',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span style={{ fontSize: 12, color: '#64748b' }}>第</span>
                      <InputNumber
                        size="small"
                        min={1}
                        max={total || undefined}
                        value={assignment.from}
                        onChange={(v) => updateAssignment(key, { from: v })}
                        style={{ width: 72 }}
                        placeholder="1"
                      />
                      <span style={{ fontSize: 12, color: '#64748b' }}>条 到第</span>
                      <InputNumber
                        size="small"
                        min={assignment.from || 1}
                        max={total || undefined}
                        value={assignment.to}
                        onChange={(v) => updateAssignment(key, { to: v })}
                        style={{ width: 72 }}
                        placeholder={total ? String(total) : '—'}
                      />
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        条{total > 0 ? `（共 ${total} 条）` : ''}
                      </span>
                      {assignment.from && assignment.to && assignment.to >= assignment.from && (
                        <Tag style={{
                          borderRadius: 20, fontSize: 11, padding: '0 7px',
                          background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5',
                        }}>
                          共 {assignment.to - assignment.from + 1} 条
                        </Tag>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </div>
  );
}

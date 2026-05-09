import React, { useEffect, useState } from 'react';
import { Button, Table, Space, Modal, Form, Input, Tag, message, Radio, Popconfirm } from 'antd';
import { PlusOutlined, SettingOutlined, EditOutlined, TagsOutlined, ApartmentOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';

const LABEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const TASK_TYPE_CONFIG = {
  text_classification: { label: '文本分类',       color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
  ner:                 { label: '命名实体识别',    color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
};

export default function TaskListPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [taskType, setTaskType] = useState('text_classification');
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  })();
  const isAdmin = user?.role === 'admin';

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data } = await client.get('/tasks');
      setTasks(data || []);
    } catch {
      message.error('加载任务失败，请检查是否已登录以及后端是否启动');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      render: (text) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{text}</span>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 160,
      render: (t) => {
        const cfg = TASK_TYPE_CONFIG[t] || TASK_TYPE_CONFIG.text_classification;
        return (
          <Tag style={{
            borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '1px 10px',
            background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
          }}>
            {cfg.label}
          </Tag>
        );
      }
    },
    {
      title: '标签 / 实体类型',
      dataIndex: 'labels',
      render: (labels = []) => (
        <Space size={[6, 6]} wrap>
          {labels.map((l, i) => (
            <Tag
              key={l}
              style={{
                background: LABEL_COLORS[i % LABEL_COLORS.length] + '18',
                border: `1px solid ${LABEL_COLORS[i % LABEL_COLORS.length]}40`,
                color: LABEL_COLORS[i % LABEL_COLORS.length],
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                padding: '1px 8px',
              }}
            >
              {l}
            </Tag>
          ))}
        </Space>
      )
    },
    {
      title: '操作',
      width: 240,
      render: (_, record) => (
        <Space>
          {isAdmin && (
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => navigate(`/tasks/${record._id}`)}
              style={{ borderRadius: 6 }}
            >
              样本管理
            </Button>
          )}
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/tasks/${record._id}/label`)}
            style={{ borderRadius: 6 }}
          >
            进入标注
          </Button>
          {isAdmin && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record._id)}
              style={{ borderRadius: 6 }}
            />
          )}
        </Space>
      )
    }
  ];

  const handleDelete = async (taskId) => {
    try {
      const { data: stats } = await client.get(`/tasks/${taskId}/stats`);
      Modal.confirm({
        title: '确认删除任务',
        content: (
          <div>
            <p>此操作<strong>不可撤销</strong>，将同时删除：</p>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li><strong>{stats.sampleCount}</strong> 条样本</li>
              <li><strong>{stats.annotationCount}</strong> 条标注</li>
            </ul>
          </div>
        ),
        okText: '确认删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          await client.delete(`/tasks/${taskId}`);
          message.success('任务已删除');
          fetchTasks();
        },
      });
    } catch {
      message.error('删除失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const labels = (values.labels || '').split(',').map((s) => s.trim()).filter(Boolean);
      const type = values.type || 'text_classification';
      await client.post('/tasks', { name: values.name, description: values.description, type, labels });
      message.success('创建任务成功');
      setCreateVisible(false);
      form.resetFields();
      setTaskType('text_classification');
      fetchTasks();
    } catch (err) {
      if (err?.response) message.error(err.response.data?.error || '创建失败');
    }
  };

  const isNer = taskType === 'ner';

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">任务管理</h1>
            <p className="page-subtitle">创建标注任务，配置标签集，并进入样本管理或标注界面</p>
          </div>
          {isAdmin && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateVisible(true)}
              style={{ fontWeight: 600, height: 38 }}
            >
              新建任务
            </Button>
          )}
        </div>
      </div>

      <div className="surface" style={{ overflow: 'hidden' }}>
        <Table
          rowKey="_id"
          dataSource={tasks}
          columns={columns}
          loading={loading}
          bordered={false}
          size="middle"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条任务`,
          }}
          style={{ borderRadius: 10 }}
        />
      </div>

      <Modal
        title="新建标注任务"
        open={createVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateVisible(false); form.resetFields(); setTaskType('text_classification'); }}
        okText="创建"
        cancelText="取消"
        width={520}
      >
        <Form
          layout="vertical"
          form={form}
          style={{ marginTop: 16 }}
          initialValues={{ type: 'text_classification' }}
          onValuesChange={(changed) => { if (changed.type) setTaskType(changed.type); }}
        >
          <Form.Item label="任务名称" name="name" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="例如：新闻主题分类 / 简历 NER" />
          </Form.Item>
          <Form.Item label="任务描述" name="description">
            <Input.TextArea rows={2} placeholder="简要描述该任务的目标与背景（可选）" />
          </Form.Item>
          <Form.Item label="任务类型" name="type">
            <Radio.Group>
              <Radio.Button value="text_classification">
                <TagsOutlined style={{ marginRight: 4 }} />文本分类
              </Radio.Button>
              <Radio.Button value="ner">
                <ApartmentOutlined style={{ marginRight: 4 }} />命名实体识别
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label={isNer ? '实体类型' : '标签集合'}
            name="labels"
            rules={[{ required: true, message: isNer ? '请输入实体类型' : '请输入标签集合' }]}
            extra={isNer
              ? '实体类型名称，用英文逗号分隔，例如：PER,ORG,LOC,TIME'
              : '用英文逗号分隔，例如：positive,negative,neutral'}
          >
            <Input placeholder={isNer ? 'PER,ORG,LOC,TIME' : 'positive,negative,neutral'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

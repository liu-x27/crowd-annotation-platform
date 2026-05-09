import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Space, Tag, message, Alert } from 'antd';
import { EditOutlined, CheckCircleOutlined } from '@ant-design/icons';
import client from '../api/client.js';

const LABEL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function LabelTaskPage() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data } = await client.get('/tasks');
      setTasks(data || []);
    } catch {
      message.error('加载任务失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

  // 判断某任务是否有个人分配的样本（由后端 hasPersonalAssignment 字段标记）
  const isPersonallyAssigned = (task) => !!task.hasPersonalAssignment;

  const hasAnyAssignment = tasks.some(isPersonallyAssigned);

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{text}</span>
          {isPersonallyAssigned(record) && (
            <Tag icon={<CheckCircleOutlined />} style={{
              borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '1px 8px',
              background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#059669',
              margin: 0,
            }}>
              已指派给我
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 160,
      render: (t) => (
        <Tag style={{ borderRadius: 20, fontSize: 11, fontWeight: 500, padding: '1px 8px' }} color="purple">
          {t}
        </Tag>
      ),
    },
    {
      title: '标签集合',
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
      ),
    },
    {
      title: '操作',
      width: 140,
      render: (_, record) => (
        <Button
          type="primary"
          icon={<EditOutlined />}
          size="small"
          onClick={() => navigate(`/tasks/${record._id}/label`)}
          style={{
            borderRadius: 6,
            fontWeight: 500,
            ...(isPersonallyAssigned(record) ? { background: '#059669', borderColor: '#059669' } : {}),
          }}
        >
          开始标注
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">标注任务</h1>
        <p className="page-subtitle">选择任务开始标注，AI 建议将辅助你更快完成</p>
      </div>

      {/* 有专属指派时展示提示条 */}
      {hasAnyAssignment && (
        <Alert
          type="success"
          icon={<CheckCircleOutlined />}
          showIcon
          message="管理员已为您指派了专属任务"
          description="标有「已指派给我」的任务是管理员专门分配给您的，请优先完成。"
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      <div className="surface" style={{ overflow: 'hidden' }}>
        <Table
          rowKey="_id"
          dataSource={tasks}
          columns={columns}
          loading={loading}
          bordered={false}
          size="middle"
          rowClassName={(record) => isPersonallyAssigned(record) ? 'assigned-row' : ''}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条任务`,
          }}
        />
      </div>
    </div>
  );
}

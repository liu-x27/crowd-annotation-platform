import React from 'react';
import { Form, Input, Button, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { UserOutlined, LockOutlined, BulbOutlined, RightOutlined } from '@ant-design/icons';
import client from '../api/client.js';

export default function LoginPage() {
  const navigate = useNavigate();

  const onFinish = async (values) => {
    try {
      const { data } = await client.post('/auth/login', values);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      message.success('登录成功');
      navigate('/tasks');
    } catch (err) {
      message.error(err.response?.data?.error || '用户名或密码错误');
    }
  };

  return (
    <div className="auth-root">
      {/* 左侧品牌面板 */}
      <div className="auth-brand">
        <div className="auth-brand-logo">
          <BulbOutlined style={{ color: '#fff' }} />
        </div>
        <h1 className="auth-brand-title">LLM 众包<br />标注平台</h1>
        <p className="auth-brand-subtitle">
          结合大语言模型与人工协作，<br />
          高效构建高质量文本分类数据集。
        </p>
        <div className="auth-brand-features">
          {[
            'LLM 智能预标注，降低人工成本',
            '多人协作众包，提升标注效率',
            '知识蒸馏训练轻量学生模型',
          ].map((f) => (
            <div className="auth-brand-feature" key={f}>
              <div className="auth-brand-feature-dot" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧表单面板 */}
      <div className="auth-form-panel">
        <div className="auth-form-box">
          <h2 className="auth-form-heading">欢迎回来</h2>
          <p className="auth-form-desc">登录后即可管理任务并开始标注</p>

          <div className="auth-form-card">
            <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="输入用户名" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="输入密码" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  size="large"
                  style={{ fontWeight: 600, height: 44 }}
                >
                  登录
                </Button>
              </Form.Item>
            </Form>
          </div>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5, color: '#64748b' }}>
            还没有账号？{' '}
            <Button
              type="link"
              style={{ padding: 0, fontWeight: 600 }}
              onClick={() => navigate('/register')}
            >
              立即注册 <RightOutlined style={{ fontSize: 11 }} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

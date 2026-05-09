import React from 'react';
import { Form, Input, Button, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { UserOutlined, LockOutlined, BulbOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import client from '../api/client.js';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const onFinish = async (values) => {
    try {
      await client.post('/auth/register', values);
      message.success('注册成功，请登录');
      navigate('/login');
    } catch (err) {
      message.error(err.response?.data?.error || '注册失败');
    }
  };

  return (
    <div className="auth-root">
      {/* 左侧品牌面板 */}
      <div className="auth-brand">
        <div className="auth-brand-logo">
          <BulbOutlined style={{ color: '#fff' }} />
        </div>
        <h1 className="auth-brand-title">开始你的<br />标注之旅</h1>
        <p className="auth-brand-subtitle">
          注册一个标注员账号，加入众包任务，<br />
          与 AI 协作共建高质量数据集。
        </p>
        <div className="auth-brand-features">
          {[
            '注册即可参与所有开放标注任务',
            'AI 辅助建议，标注更轻松高效',
            '数据贡献将用于训练更好的模型',
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
          <h2 className="auth-form-heading">创建账号</h2>
          <p className="auth-form-desc">填写以下信息，即可开始标注</p>

          <div className="auth-form-card">
            <Form layout="vertical" form={form} onFinish={onFinish} requiredMark={false}>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="设置用户名" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="设置密码" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  size="large"
                  style={{ fontWeight: 600, height: 44 }}
                >
                  注册
                </Button>
              </Form.Item>
            </Form>
          </div>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13.5, color: '#64748b' }}>
            已有账号？{' '}
            <Button
              type="link"
              style={{ padding: 0, fontWeight: 600 }}
              onClick={() => navigate('/login')}
            >
              <ArrowLeftOutlined style={{ fontSize: 11 }} /> 返回登录
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

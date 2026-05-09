import React, { useState, useEffect } from 'react';
import { Layout, Menu, Dropdown, Avatar, Badge } from 'antd';
import { Outlet, Link, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  ProjectOutlined, FormOutlined, DatabaseOutlined,
  UserOutlined, LogoutOutlined, BulbOutlined, TeamOutlined
} from '@ant-design/icons';
import TaskListPage from './TaskListPage.jsx';
import LabelPage from './LabelPage.jsx';
import TaskDetailPage from './TaskDetailPage.jsx';
import LabelTaskPage from './LabelTaskPage.jsx';
import DataManagementPage from './DataManagementPage.jsx';
import AnnotatorPage from './AnnotatorPage.jsx';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedKeys, setSelectedKeys] = useState(['tasks']);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  })();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const path = location.pathname;
    if (path === '/tasks' || path.startsWith('/tasks/')) setSelectedKeys(['tasks']);
    else if (path.startsWith('/label')) setSelectedKeys(['label']);
    else if (path.startsWith('/data')) setSelectedKeys(['data']);
    else if (path.startsWith('/annotators')) setSelectedKeys(['annotators']);
    else setSelectedKeys(['tasks']);
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  };

  const menuItems = [
    { key: 'tasks', icon: <ProjectOutlined />, label: '任务管理' },
    { key: 'label', icon: <FormOutlined />, label: '标注任务' },
    ...(isAdmin ? [
      { key: 'data', icon: <DatabaseOutlined />, label: '数据管理' },
      { key: 'annotators', icon: <TeamOutlined />, label: '标注员管理' },
    ] : [])
  ];

  const userDropdownItems = {
    items: [
      {
        key: 'user-info',
        label: (
          <div style={{ padding: '4px 0', pointerEvents: 'none' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{user?.username}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
              {user?.role === 'admin' ? '管理员' : '标注员'}
            </div>
          </div>
        ),
        disabled: true
      },
      { type: 'divider' },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '退出登录',
        danger: true,
        onClick: handleLogout
      }
    ]
  };

  const avatarColor = user?.role === 'admin' ? '#6366f1' : '#10b981';
  const avatarLetter = (user?.username || '?')[0].toUpperCase();

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-header-brand">
          <div className="app-header-logo">
            <BulbOutlined />
          </div>
          <div>
            <div className="app-header-title">LLM 众包标注平台</div>
            <div className="app-header-subtitle">知识蒸馏 · 数据标注 · 模型训练</div>
          </div>
        </div>

        <div className="app-header-user">
          <Dropdown menu={userDropdownItems} placement="bottomRight" trigger={['click']}>
            <div className="user-chip">
              <Avatar
                size={26}
                style={{ background: avatarColor, fontSize: 12, fontWeight: 700, flexShrink: 0 }}
              >
                {avatarLetter}
              </Avatar>
              <div>
                <div className="user-chip-name">{user?.username}</div>
                <div className="user-chip-role">{user?.role === 'admin' ? '管理员' : '标注员'}</div>
              </div>
            </div>
          </Dropdown>
        </div>
      </Header>

      <Layout>
        <Sider width={220} className="app-sider">
          <div className="sidebar-top">
            <div className="sidebar-app-name">工作台</div>
            <span className="sidebar-app-tag">DEMO v0.1</span>
          </div>
          <Menu
            mode="inline"
            selectedKeys={selectedKeys}
            items={menuItems}
            onClick={({ key }) => {
              setSelectedKeys([key]);
              if (key === 'tasks') navigate('/tasks');
              else if (key === 'label') navigate('/label');
              else if (key === 'data' && isAdmin) navigate('/data');
              else if (key === 'annotators' && isAdmin) navigate('/annotators');
            }}
          />
        </Sider>

        <Content className="app-content">
          <Routes>
            <Route index element={<TaskListPage />} />
            <Route path="tasks" element={<TaskListPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="tasks/:taskId/label" element={<LabelPage />} />
            <Route path="label" element={<LabelTaskPage />} />
            {isAdmin && <Route path="data" element={<DataManagementPage />} />}
            {isAdmin && <Route path="annotators" element={<AnnotatorPage />} />}
            <Route path="*" element={<TaskListPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

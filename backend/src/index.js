import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import annotationRoutes from './routes/annotations.js';
import llmRoutes from './routes/llm.js';
import distillRoutes from './routes/distill.js';
import userRoutes from './routes/users.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.warn('[警告] JWT_SECRET 未设置，使用默认值 dev_secret，生产环境请务必配置该变量');
}

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crowd_platform';
const PORT = process.env.PORT || 4000;

async function bootstrap() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');

    app.get('/api/health', (_req, res) => {
      res.json({ ok: true });
    });

    app.use('/api/auth', authRoutes);
    app.use('/api/tasks', taskRoutes);
    app.use('/api/annotations', annotationRoutes);
    app.use('/api/llm', llmRoutes);
    app.use('/api/distill', distillRoutes);
    app.use('/api/users', userRoutes);

    // 全局错误处理中间件（必须在所有路由之后注册）
    app.use((err, _req, res, _next) => {
      console.error('[未捕获错误]', err);
      const status = err.status || err.statusCode || 500;
      res.status(status).json({ error: err.message || 'Internal server error' });
    });

    app.listen(PORT, () => {
      console.log(`Backend API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start backend:', err);
    process.exit(1);
  }
}

bootstrap();


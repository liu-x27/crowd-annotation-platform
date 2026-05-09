import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: 'username already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    // role 固定为 annotator，防止客户端自行提权
    const user = await User.create({ username, passwordHash, role: 'annotator' });
    res.json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message || '注册失败' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });

    const token = jwt.sign(
      { id: user._id.toString(), username: user.username, role: user.role },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message || '登录失败' });
  }
});

export default router;



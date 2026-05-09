import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'annotator'], default: 'annotator' }
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);



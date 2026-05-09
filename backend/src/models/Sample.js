import mongoose from 'mongoose';

const sampleSchema = new mongoose.Schema(
  {
    taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    content:    { type: String, required: true },
    meta:       { type: Object },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

sampleSchema.index({ taskId: 1 });
sampleSchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model('Sample', sampleSchema);



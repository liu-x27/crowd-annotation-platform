import mongoose from 'mongoose';

const spanSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true },
    end:   { type: Number, required: true },
    label: { type: String, required: true },
    text:  { type: String, required: true },
  },
  { _id: false }
);

const annotationSchema = new mongoose.Schema(
  {
    taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task',  required: true },
    sampleId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Sample', required: true },
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    label:      { type: String },                          // 文本分类时使用；NER 时为 null
    spans:      { type: [spanSchema], default: [] },       // NER 时使用
    fromLLM:    { type: Boolean, default: false },
    confidence: { type: Number },
    status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

// 常用查询索引
annotationSchema.index({ taskId: 1, status: 1 });
annotationSchema.index({ taskId: 1, fromLLM: 1 });
annotationSchema.index({ sampleId: 1 });
annotationSchema.index({ taskId: 1, userId: 1 });

export default mongoose.model('Annotation', annotationSchema);

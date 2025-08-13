import mongoose from 'mongoose';

const lectureRequestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  creatorName: { type: String, required: true, trim: true },
  subject: { type: String, required: true, trim: true },
  semester: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true },
  academicLevel: { type: String, required: true, trim: true },
  fileData: { type: Buffer, required: true },
  fileName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const LectureRequest = mongoose.model('LectureRequest', lectureRequestSchema);

export default LectureRequest;
// models/LowLectureReport.js
import { Schema, model } from 'mongoose';

const lowLectureReportSchema = new Schema({
  weekStart: {
    type: Date,
    required: true
  },
  weekEnd: {
    type: Date,
    required: true
  },
  members: [{
    _id: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    lowLectureWeekCount: { type: Number, default: 0, min: 0 },
    underTargetStudents: [{
      studentName: { type: String, required: true },
      studentEmail: { type: String, required: true },
      academicLevel: { type: String, default: 'غير محدد' },
      underTargetSubjects: [{
        name: { type: String, required: true },
        minLectures: { type: Number, required: true, min: 0 },
        deliveredLectures: { type: Number, required: true, min: 0 }
      }]
    }],
    lectures: [{
      _id: { type: Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      subject: { type: String, required: true },
      studentEmail: { type: String, required: true },
      link: { type: String, required: true },
      createdAt: { type: Date, required: true }
    }]
  }],
  totalUsersProcessed: {
    type: Number,
    required: true
  },
  membersWithLowLectures: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

lowLectureReportSchema.index({ weekStart: 1 }, { unique: true });

export default model('LowLectureReport', lowLectureReportSchema);
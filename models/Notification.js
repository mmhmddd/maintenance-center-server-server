import { Schema, model } from 'mongoose';

const notificationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['lecture_added', 'low_lecture_count_per_subject', 'other'], // أضفنا القيمة الجديدة هنا
    required: true
  },
  lectureDetails: {
    link: { type: String },
    name: { type: String },
    subject: { type: String }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  read: {
    type: Boolean,
    default: false
  }
});

export default model('Notification', notificationSchema);
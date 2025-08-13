import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'leader'],
    default: 'user',
    required: true,
  },
  name: {
    type: String,
    required: false,
  },
  profileImage: {
    type: String,
    default: null,
  },
  numberOfStudents: {
    type: Number,
    default: 0,
    min: 0
  },
  subjects: [{
    type: String,
    trim: true
  }],
  students: [{
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    grade: { type: String, required: false, trim: true },
    subjects: [{ type: String, required: false, trim: true }]
  }],
  meetings: [{
    _id: { type: Schema.Types.ObjectId, auto: true },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
  }],
  lectures: [{
    link: { type: String, required: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    _id: { type: Schema.Types.ObjectId, auto: true }
  }],
  lectureCount: { type: Number, default: 0 },
  resetToken: {
    type: String,
    default: null
  },
  tokenExpire: {
    type: Date,
    default: null
  }
});

export default model('User', userSchema);
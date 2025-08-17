import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true, // Ensure email is stored in lowercase
    trim: true
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
  profileImagePublicId: {
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
    trim: true,
    default: []
  }],
  students: [{
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    grade: { type: String, required: false, trim: true },
    subjects: [{
      name: { type: String, required: true, trim: true },
      minLectures: { type: Number, required: true, min: 0 }
    }]
  }],
  meetings: [{
    _id: { type: Schema.Types.ObjectId, auto: true },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    reminded: { type: Boolean, default: false }  
  }],
  lectures: [{
    link: { type: String, required: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    studentEmail: { type: String, required: true, lowercase: true, trim: true },
    createdAt: { type: Date, default: Date.now },
    _id: { type: Schema.Types.ObjectId, auto: true }
  }],
lowLectureWeekCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastLowLectureWeek: {
    type: Date,
    default: null
  },
  resetToken: {
    type: String,
    default: null
  },
  tokenExpire: {
    type: Date,
    default: null
  },
  messages: [{
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    displayUntil: { type: Date, required: true, index: { expires: 0 } }
  }]
});

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ 'messages.displayUntil': 1 }, { expireAfterSeconds: 0 });

export default model('User', userSchema);
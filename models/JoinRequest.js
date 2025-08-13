import { Schema, model } from 'mongoose';

const joinRequestSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  number: {
    type: String,
    required: true,
  },
  academicSpecialization: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  volunteerHours: {
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
    phone: { type: String, required: true }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default model('JoinRequest', joinRequestSchema);
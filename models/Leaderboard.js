import { Schema, model } from 'mongoose';

const leaderboardSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['متطوع', 'قاده'],
  },
  rank: {
    type: String,
    required: false, 
  },
  name: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default: null,
  },
  imagePublicId: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default model('Leaderboard', leaderboardSchema);
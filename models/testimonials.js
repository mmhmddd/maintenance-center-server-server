import mongoose from 'mongoose';

const testimonialSchema = new mongoose.Schema({
  image: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  name: { type: String, required: true },
  major: { type: String, required: true },
  reviewText: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const Testimonial = mongoose.model('Testimonial', testimonialSchema);

export default Testimonial;
import express, { json } from 'express';
import { connect } from 'mongoose';
import { config } from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import cloudinary from 'cloudinary';
import cron from 'node-cron';
import User from './models/User.js';
import sendEmail from './utils/email.js';

// Import routes
import leaderboardRoutes from './routes/leaderboard.js';
import apiRoutes from './routes/api.js';
import pdfRoutes from './routes/pdfRoutes.js';
import testimonialsRoutes from './routes/testimonials.js';
import lectureRoutes from './routes/lectureRoutes.js';
import galleryRoutes from './routes/gallery.js';
import lectureRequestRoutes from './routes/lectureRequestRoutes.js';

// Load environment variables
config();

// Validate environment variables
if (!process.env.MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined in .env file');
  process.exit(1);
}
if (!process.env.PORT) {
  console.warn('Warning: PORT is not defined in .env file, defaulting to 5000');
}
if (!process.env.FRONTEND_URL) {
  console.warn('Warning: FRONTEND_URL is not defined in .env file, defaulting to https://www.qatrah-ghaith.com');
}
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Error: Cloudinary credentials are missing in .env file');
  process.exit(1);
}

// Configure Cloudinary
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Connect to MongoDB
connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Create Express app
const app = express();

// Setup directory info
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://www.qatrah-ghaith.com',
  credentials: true
}));
app.use(json());

// Fallback for old upload routes to prevent unmatched errors
app.get('/api/Uploads/*', (req, res) => {
  console.log(`Old upload route requested: ${req.originalUrl}`);
  res.status(410).json({ message: 'هذا المسار القديم لم يعد مدعومًا. استخدم /api/gallery/images للصور.' });
});

// Register routes
console.log('Registering Leaderboard routes at /api/leaderboard');
app.use('/api/leaderboard', leaderboardRoutes);
console.log('Registering API routes at /api');
app.use('/api', apiRoutes);
console.log('Registering PDF routes at /api/pdf');
app.use('/api/pdf', pdfRoutes);
console.log('Registering Testimonials routes at /api/testimonials');
app.use('/api/testimonials', testimonialsRoutes);
console.log('Registering Lecture routes at /api/lectures');
app.use('/api/lectures', lectureRoutes);
console.log('Registering Gallery routes at /api/gallery');
app.use('/api/gallery', galleryRoutes);
console.log('Registering Lecture Request routes at /api/lecture-requests');
app.use('/api/lecture-requests', lectureRequestRoutes);

// Improved cron job for meeting reminders
cron.schedule('* * * * *', async () => {
  console.log('Checking meeting reminders...');
  try {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const users = await User.find({
      'meetings.reminded': false,
      'meetings.date': { $gte: now, $lte: inOneHour }
    }).lean(); // Use lean() for better performance

    const emailPromises = [];
    for (const user of users) {
      for (const meeting of user.meetings) {
        if (meeting.reminded) continue;

        // Calculate meeting time
        const [hours, minutes] = meeting.startTime.split(':').map(Number);
        const meetingTime = new Date(meeting.date);
        meetingTime.setHours(hours, minutes, 0, 0);

        // Reminder time (30 minutes before)
        const reminderTime = new Date(meetingTime.getTime() - 30 * 60 * 1000);

        if (now >= reminderTime && now < meetingTime) {
          emailPromises.push(
            sendEmail({
              to: user.email,
              subject: 'تذكير بموعد اجتماع',
              text: `مرحبًا،\n\nتذكير: اجتماعك "${meeting.title}" بعد 30 دقيقة في ${meeting.date.toISOString().split('T')[0]} الساعة ${meeting.startTime}.\n\nتحياتنا,\nفريق قطرة غيث`,
            }).then(() => {
              console.log(`Sent reminder to ${user.email} for meeting ${meeting._id}`);
              // Update reminded status
              return User.updateOne(
                { _id: user._id, 'meetings._id': meeting._id },
                { $set: { 'meetings.$.reminded': true } }
              );
            }).catch((error) => {
              console.error(`Failed to send reminder to ${user.email} for meeting ${meeting._id}:`, error);
            })
          );
        }
      }
    }

    await Promise.all(emailPromises);
    console.log(`Processed ${emailPromises.length} reminders`);
  } catch (error) {
    console.error('Error in meeting reminder cron job:', error);
  }
});

// Fallback for unmatched routes
app.use((req, res) => {
  console.log(`Unmatched route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
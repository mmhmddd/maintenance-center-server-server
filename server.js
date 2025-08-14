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

process.env.TZ = 'Africa/Cairo';

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
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  console.error('Error: Gmail credentials are missing in .env file');
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

// Cron job for daily meeting reminders (runs at 00:01 every day)
cron.schedule('1 0 * * *', async () => {
  console.log('Checking daily meeting reminders at:', new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }));
  try {
    const now = new Date();
    // Convert to UTC for query
    const nowUTC = new Date(now.getTime() - 3 * 60 * 60 * 1000); // EEST is UTC+3
    const startOfDayUTC = new Date(nowUTC);
    startOfDayUTC.setUTCHours(0, 0, 0, 0);
    const endOfDayUTC = new Date(nowUTC);
    endOfDayUTC.setUTCHours(23, 59, 59, 999);

    console.log(`Querying meetings for today UTC: ${startOfDayUTC.toISOString()} to ${endOfDayUTC.toISOString()}`);

    // Find users with meetings today that haven't been reminded
    const users = await User.find({
      'meetings.reminded': false,
      'meetings.date': { $gte: startOfDayUTC, $lte: endOfDayUTC }
    }).lean();

    console.log(`Found ${users.length} users with potential meetings to remind today`);

    const emailPromises = [];
    for (const user of users) {
      console.log(`Processing user: ${user.email}, Meetings count: ${user.meetings.length}`);
      
      // Collect all meetings for this user today
      const meetingsToRemind = user.meetings.filter(meeting => {
        if (meeting.reminded) {
          console.log(`Meeting ${meeting._id} already reminded, skipping`);
          return false;
        }
        const meetingDate = new Date(meeting.date);
        return meetingDate >= startOfDayUTC && meetingDate <= endOfDayUTC;
      });

      if (meetingsToRemind.length === 0) {
        console.log(`No meetings to remind for user ${user.email}`);
        continue;
      }

      // Generate HTML for all meetings in one email
      const meetingList = meetingsToRemind.map(meeting => `
        <li>
          <strong>العنوان:</strong> ${meeting.title}<br>
          <strong>التاريخ:</strong> ${meeting.date.toISOString().split('T')[0]}<br>
          <strong>الوقت:</strong> ${meeting.startTime}<br>
          <strong>المدة:</strong> ${meeting.startTime} - ${meeting.endTime}
        </li>
      `).join('');

      console.log(`Sending daily reminder to ${user.email} for ${meetingsToRemind.length} meetings`);
      emailPromises.push(
        sendEmail({
          to: user.email,
          subject: 'تذكير بمواعيد اليوم',
          html: `
            <h2>تذكير بمواعيد اليوم</h2>
            <p>مرحبًا،</p>
            <p>لديك ${meetingsToRemind.length} موعد${meetingsToRemind.length > 1 ? 'ات' : ''} اليوم:</p>
            <ul>
              ${meetingList}
            </ul>
            <p>يرجى الاستعداد للمواعيد.</p>
            <p>تحياتنا،<br>فريق قطرة غيث</p>
          `,
        }).then(() => {
          console.log(`Successfully sent daily reminder to ${user.email} for ${meetingsToRemind.length} meetings`);
          // Update reminded status for all meetings
          const updatePromises = meetingsToRemind.map(meeting =>
            User.updateOne(
              { _id: user._id, 'meetings._id': meeting._id },
              { $set: { 'meetings.$.reminded': true } }
            )
          );
          return Promise.all(updatePromises);
        }).catch((error) => {
          console.error(`Failed to send daily reminder to ${user.email}:`, error.message);
          throw error;
        })
      );
    }

    await Promise.all(emailPromises);
    console.log(`Processed ${emailPromises.length} daily meeting reminders`);
  } catch (error) {
    console.error('Error in daily meeting reminder cron job:', error.message, error.stack);
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
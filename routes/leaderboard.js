import express from 'express';
import { addUserToLeaderboard, getLeaderboard, editUserInLeaderboard, deleteUserFromLeaderboard } from '../controllers/leaderboardController.js';
import authMiddleware from '../middleware/auth.js';
import multer from 'multer';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype) {
      return cb(null, true);
    }
    cb(new Error('نوع الملف غير مدعوم. يجب أن يكون JPEG أو PNG'));
  }
});

// Add a user to the leaderboard by email
router.post('/add', authMiddleware, upload.single('image'), addUserToLeaderboard);

// Get the leaderboard
router.get('/', getLeaderboard);

// Edit a user in the leaderboard
router.put('/edit', authMiddleware, upload.single('image'), editUserInLeaderboard);

// Delete a user from the leaderboard
router.delete('/remove', authMiddleware, deleteUserFromLeaderboard);

export default router;
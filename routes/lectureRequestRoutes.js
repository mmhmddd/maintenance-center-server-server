import express from 'express';
import { uploadLectureRequest, getPendingLectureRequests, approveOrRejectLectureRequest, getLectureFile } from '../controllers/lectureRequestController.js';
import authMiddleware from '../middleware/auth.js';
import adminMiddleware from '../middleware/admin.js';
import multer from 'multer';

const router = express.Router();

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const isValid = file.mimetype === 'application/pdf' && /\.pdf$/.test(file.originalname.toLowerCase());
  if (isValid) {
    cb(null, true);
  } else {
    cb(new Error('الملفات المسموح بها هي: PDF فقط'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/upload', authMiddleware, upload.single('pdfFile'), uploadLectureRequest);
router.get('/pending', authMiddleware, adminMiddleware, getPendingLectureRequests);
router.post('/:id/action', authMiddleware, adminMiddleware, approveOrRejectLectureRequest);
router.get('/:id/file', authMiddleware, getLectureFile);

export default router;
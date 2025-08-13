import express from 'express';
import { addImage, editImage, deleteImage, getAllImages, getImageById } from '../controllers/galleryController.js';
import multer from 'multer';
import path from 'path'; // إضافة هذا الاستيراد لإصلاح ReferenceError
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('الملفات المسموح بها هي: JPEG, JPG, PNG'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Routes
router.post('/images', authMiddleware, upload.single('image'), addImage);
router.put('/images/:id', authMiddleware, upload.single('image'), editImage);
router.delete('/images/:id', authMiddleware, deleteImage);
router.get('/images', getAllImages);
router.get('/images/:id', getImageById);

export default router;
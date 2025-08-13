import express from 'express';
import PDF from '../models/pdf.js';
import authMiddleware from '../middleware/auth.js';
import mongoose from 'mongoose';
import multer from 'multer';

// Initialize router
const router = express.Router();

// Configure Multer for file uploads
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  console.log('Multer file filter:', file.originalname, file.mimetype);
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
  limits: { fileSize: 10 * 1024 * 1024 } // Limit file size to 10MB
});

// Upload PDF
router.post('/upload', authMiddleware, upload.single('pdfFile'), async (req, res) => {
  console.log('POST /api/pdf/upload called', {
    body: req.body,
    file: req.file ? { originalname: req.file.originalname, mimetype: req.file.mimetype } : null
  });
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار ملف PDF للرفع' });
    }
    const { title, description, creatorName, subject, semester, country, academicLevel } = req.body;
    if (!title || !description || !creatorName || !subject || !semester || !country || !academicLevel) {
      return res.status(400).json({ message: 'جميع الحقول (العنوان، الوصف، اسم المنشئ، المادة، الفصل الدراسي، الدولة، المرحلة الدراسية) مطلوبة' });
    }

    const pdf = new PDF({
      title,
      description,
      creatorName,
      subject,
      semester,
      country,
      academicLevel,
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.userId
    });

    await pdf.save();
    res.status(201).json({
      message: 'تم رفع ملف PDF بنجاح',
      pdf: {
        id: pdf._id.toString(),
        title: pdf.title,
        description: pdf.description,
        creatorName: pdf.creatorName,
        subject: pdf.subject,
        semester: pdf.semester,
        country: pdf.country,
        academicLevel: pdf.academicLevel,
        fileName: pdf.fileName,
        uploadedBy: pdf.uploadedBy.toString(),
        createdAt: pdf.createdAt
      }
    });
  } catch (error) {
    console.error('Upload PDF error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// List PDFs
router.get('/list', async (req, res) => {
  try {
    const pdfs = await PDF.find()
      .select('title description creatorName subject semester country academicLevel fileName uploadedBy createdAt')
      .populate('uploadedBy', 'email'); // Optionally populate user email

    // Map the PDFs to match the frontend Pdf interface
    const pdfList = pdfs.map(pdf => ({
      id: pdf._id.toString(),
      title: pdf.title,
      description: pdf.description,
      creatorName: pdf.creatorName,
      subject: pdf.subject,
      semester: pdf.semester,
      country: pdf.country,
      academicLevel: pdf.academicLevel,
      fileName: pdf.fileName,
      uploadedBy: pdf.uploadedBy ? pdf.uploadedBy.email : 'Unknown', 
      createdAt: pdf.createdAt.toISOString(),
    }));

    res.json({
      message: 'تم جلب قائمة ملفات PDF بنجاح',
      pdfs: pdfList,
    });
  } catch (error) {
    console.error('خطأ في جلب قائمة ملفات PDF:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});


// Delete PDF
router.delete('/:id', authMiddleware, async (req, res) => {
  console.log('DELETE /api/pdf/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الملف غير صالح' });
    }
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
    }
    await PDF.deleteOne({ _id: req.params.id });
    console.log('PDF deleted from database:', req.params.id);
    res.status(200).json({ message: 'تم حذف الملف بنجاح' });
  } catch (error) {
    console.error('Delete PDF error:', {
      message: error.message,
      stack: error.stack,
      id: req.params.id,
      userId: req.userId
    });
    res.status(500).json({ message: 'خطأ في حذف الملف', error: error.message });
  }
});

// View PDF
router.get('/view/:id', authMiddleware, async (req, res) => {
  console.log('GET /api/pdf/view/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الملف غير صالح' });
    }
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
    }

    res.set({
      'Content-Type': pdf.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(pdf.fileName)}"`
    });
    res.send(pdf.fileData);
  } catch (error) {
    console.error('View PDF error:', {
      message: error.message,
      stack: error.stack,
      id: req.params.id,
      userId: req.userId
    });
    res.status(500).json({ message: 'خطأ في عرض الملف', error: error.message });
  }
});

export default router;
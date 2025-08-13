import LectureRequest from '../models/LectureRequest.js';
import PDF from '../models/pdf.js';
import User from '../models/User.js';
import JoinRequest from '../models/JoinRequest.js';
import mongoose from 'mongoose';

export const uploadLectureRequest = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار ملف PDF للرفع' });
    }
    const { title, description, creatorName, subject, semester, country, academicLevel } = req.body;
    if (!title || !description || !creatorName || !subject || !semester || !country || !academicLevel) {
      return res.status(400).json({ message: 'جميع الحقول (العنوان، الوصف، اسم المنشئ، المادة، الفصل الدراسي، الدولة، المرحلة الدراسية) مطلوبة' });
    }

    const lectureRequest = new LectureRequest({
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
      uploadedBy: req.userId,
      status: 'pending'
    });

    await lectureRequest.save();
    res.status(201).json({
      message: 'تم تقديم طلب رفع المحاضرة بنجاح، بانتظار الموافقة',
      lectureRequest: {
        id: lectureRequest._id.toString(),
        title: lectureRequest.title,
        description: lectureRequest.description,
        creatorName: lectureRequest.creatorName,
        subject: lectureRequest.subject,
        semester: lectureRequest.semester,
        country: lectureRequest.country,
        academicLevel: lectureRequest.academicLevel,
        fileName: lectureRequest.fileName,
        status: lectureRequest.status,
        uploadedBy: lectureRequest.uploadedBy.toString(),
        createdAt: lectureRequest.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const getPendingLectureRequests = async (req, res) => {
  try {
    const lectureRequests = await LectureRequest.find({ status: 'pending' })
      .select('title description creatorName subject semester country academicLevel fileName uploadedBy createdAt')
      .populate('uploadedBy', 'email');
    
    const lectureRequestList = lectureRequests.map(request => ({
      id: request._id.toString(),
      title: request.title,
      description: request.description,
      creatorName: request.creatorName,
      subject: request.subject,
      semester: request.semester,
      country: request.country,
      academicLevel: request.academicLevel,
      fileName: request.fileName,
      uploadedBy: request.uploadedBy ? request.uploadedBy.email : 'Unknown',
      createdAt: request.createdAt.toISOString(),
    }));

    res.json({
      message: 'تم جلب طلبات المحاضرات بانتظار الموافقة بنجاح',
      lectureRequests: lectureRequestList
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const approveOrRejectLectureRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'معرف الطلب غير صالح' });
    }

    if (!['approve', 'reject'].includes(action)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الإجراء يجب أن يكون "approve" أو "reject"' });
    }

    const lectureRequest = await LectureRequest.findById(id).session(session);
    if (!lectureRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    if (lectureRequest.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    if (action === 'reject') {
      lectureRequest.status = 'rejected';
      await lectureRequest.save({ session });
      await session.commitTransaction();
      session.endSession();
      return res.json({ message: 'تم رفض الطلب بنجاح' });
    }

    lectureRequest.status = 'approved';
    const pdf = new PDF({
      title: lectureRequest.title,
      description: lectureRequest.description,
      creatorName: lectureRequest.creatorName,
      subject: lectureRequest.subject,
      semester: lectureRequest.semester,
      country: lectureRequest.country,
      academicLevel: lectureRequest.academicLevel,
      fileData: lectureRequest.fileData,
      fileName: lectureRequest.fileName,
      mimeType: lectureRequest.mimeType,
      uploadedBy: lectureRequest.uploadedBy
    });

    await pdf.save({ session });

    const user = await User.findById(lectureRequest.uploadedBy).session(session);
    if (user) {
      user.lectureCount = (user.lectureCount || 0) + 1;
      await user.save({ session });
      
      const joinRequest = await JoinRequest.findOne({ email: user.email }).session(session);
      if (joinRequest) {
        joinRequest.volunteerHours = (joinRequest.volunteerHours || 0) + 1;
        await joinRequest.save({ session });
      }
    }

    await lectureRequest.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'تمت الموافقة على الطلب ونقله إلى المكتبة بنجاح' });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const getLectureFile = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'معرف الطلب غير صالح' });
    }

    const lectureRequest = await LectureRequest.findById(id);
    if (!lectureRequest) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    if (lectureRequest.mimeType !== 'application/pdf') {
      return res.status(400).json({ message: 'الملف ليس بصيغة PDF' });
    }

    res.set({
      'Content-Type': lectureRequest.mimeType,
      'Content-Disposition': `inline; filename="${lectureRequest.fileName}"`,
    });

    res.send(lectureRequest.fileData);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في استرجاع الملف', error: error.message });
  }
};
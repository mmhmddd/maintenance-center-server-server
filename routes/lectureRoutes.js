import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import JoinRequest from '../models/JoinRequest.js';
import Notification from '../models/Notification.js';
import validator from 'validator';
import mongoose from 'mongoose';

const router = express.Router();

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Add a lecture
router.post('/', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { link, name, subject } = req.body;

    // Validate inputs
    if (!link || !name || !subject) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'رابط المحاضرة، الاسم، والمادة مطلوبة' });
    }
    if (!validator.isURL(link)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'رابط المحاضرة غير صالح' });
    }
    if (!validator.isLength(name, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'اسم المحاضرة يجب أن يكون بين 1 و100 حرف' });
    }
    if (!validator.isLength(subject, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'اسم المادة يجب أن يكون بين 1 و100 حرف' });
    }

    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const joinRequest = await JoinRequest.findOne({ email: user.email }).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    if (!Array.isArray(user.lectures)) {
      user.lectures = [];
    }

    const lecture = { link, name, subject, createdAt: new Date() };
    user.lectures.push(lecture);
    user.lectureCount = (user.lectureCount || 0) + 1;
    joinRequest.volunteerHours = (joinRequest.volunteerHours || 0) + 2;

    await Notification.deleteMany(
      {
        userId: req.userId,
        type: 'low_lecture_count_per_subject',
        'lectureDetails.subject': subject
      },
      { session }
    );

    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const subjects = joinRequest.subjects || user.subjects || [];
    if (subjects.length > 0) {
      const lectureCounts = {};
      subjects.forEach(subj => {
        lectureCounts[subj] = 0;
      });

      user.lectures.forEach(lec => {
        if (new Date(lec.createdAt) >= startOfWeek && new Date(lec.createdAt) <= endOfWeek) {
          if (lectureCounts.hasOwnProperty(lec.subject)) {
            lectureCounts[lec.subject]++;
          }
        }
      });

      if (lectureCounts.hasOwnProperty(subject)) {
        lectureCounts[subject]++;
      }

      const underTargetSubjects = Object.keys(lectureCounts).filter(subj => lectureCounts[subj] < 2);
      if (underTargetSubjects.length > 0) {
        const warningNotification = new Notification({
          userId: req.userId,
          message: `تحذير: لم يتم تحقيق الهدف الأسبوعي (محاضرتان لكل مادة). المواد التي لم تحقق الهدف: ${underTargetSubjects.join(', ')}.`,
          type: 'low_lecture_count_per_subject',
          lectureDetails: { link, name, subject }
        });
        await warningNotification.save({ session });
      }
    }

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const lectureCountThisMonth = user.lectures.filter(lecture => new Date(lecture.createdAt) >= startOfMonth).length + 1;
    if (lectureCountThisMonth < 2) {
      const warningNotification = new Notification({
        userId: req.userId,
        message: `تحذير: المستخدم ${user.email} قام برفع ${lectureCountThisMonth} محاضرة فقط هذا الشهر`,
        type: 'low_lecture_count'
      });
      await warningNotification.save({ session });
    }

    const notification = new Notification({
      userId: req.userId,
      message: `تمت إضافة محاضرة جديدة بواسطة ${user.email}: ${name} (${subject}) - ${link}`,
      type: 'lecture_added',
      lectureDetails: { link, name, subject }
    });
    await notification.save({ session });

    await Promise.all([user.save({ session }), joinRequest.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('تم إضافة المحاضرة:', {
      userId: req.userId,
      link,
      name,
      subject,
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
    res.json({
      success: true,
      message: 'تم إضافة المحاضرة بنجاح',
      lecture,
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
  } catch (error) {
    console.error('خطأ في إضافة المحاضرة:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a lecture link (Admin only)
router.delete('/:lectureId', authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'يجب أن تكون أدمن لتتمكن من حذف المحاضرة' });
    }

    const lectureId = req.params.lectureId;
    if (!mongoose.Types.ObjectId.isValid(lectureId)) {
      return res.status(400).json({ message: 'معرف المحاضرة غير صالح' });
    }

    const user = await User.findOne({ 'lectures._id': lectureId });
    if (!user) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    const lecture = user.lectures.id(lectureId);
    if (!lecture) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    user.lectures.pull(lectureId);
    user.lectureCount = (user.lectureCount || 1) - 1;
    await user.save();

    console.log('تم حذف المحاضرة:', { lectureId, userId: user._id });
    res.json({ success: true, message: 'تم حذف المحاضرة بنجاح', lectureCount: user.lectureCount });
  } catch (error) {
    console.error('خطأ في حذف المحاضرة:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Get notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      message: 'تم جلب الإشعارات بنجاح',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('خطأ في جلب الإشعارات:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب الإشعارات',
      error: error.message
    });
  }
});

// Mark notifications as read
router.post('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.userId, read: false },
      { $set: { read: true } }
    );
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      message: 'تم تحديد الإشعارات كمقروءة',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('خطأ في تحديد الإشعارات كمقروءة:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في تحديد الإشعارات كمقروءة',
      error: error.message
    });
  }
});

// Delete a specific notification
router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const notificationId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: 'معرف الإشعار غير صالح' });
    }

    const notification = await Notification.findOne({ _id: notificationId, userId: req.userId });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'الإشعار غير موجود أو لا ينتمي إلى المستخدم' });
    }

    await Notification.deleteOne({ _id: notificationId });
    res.json({ success: true, message: 'تم حذف الإشعار بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الإشعار:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Get members with fewer than two lectures per subject in the current week (Admin only)
router.get('/low-lecture-members', authMiddleware, async (req, res) => {
  try {
    console.log('Fetching low lecture members for user:', req.userId, 'Role:', req.userRole);
    if (req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'يجب أن تكون أدمن لعرض هذه المعلومات' });
    }

    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const users = await User.find({}).lean();
    const lowLectureMembers = [];

    for (const user of users) {
      if (!user.email) {
        console.warn(`User with ID ${user._id} has no email`);
        continue;
      }
      const joinRequest = await JoinRequest.findOne({ email: user.email }).lean();
      if (!joinRequest) {
        console.log(`No join request for user: ${user.email}`);
        continue;
      }
      if (!joinRequest.subjects || !Array.isArray(joinRequest.subjects) || joinRequest.subjects.length === 0) {
        console.log(`No valid subjects for user: ${user.email}`);
        continue;
      }
      if (!user.lectures || !Array.isArray(user.lectures)) {
        console.log(`No lectures for user: ${user.email}`);
        continue;
      }

      const lectureCounts = {};
      joinRequest.subjects.forEach(subj => {
        lectureCounts[subj] = 0;
      });

      user.lectures.forEach(lec => {
        if (!lec.createdAt || !lec.subject) {
          console.warn(`Invalid lecture data for user ${user.email}:`, lec);
          return;
        }
        if (new Date(lec.createdAt) >= startOfWeek && new Date(lec.createdAt) <= endOfWeek) {
          if (lectureCounts.hasOwnProperty(lec.subject)) {
            lectureCounts[lec.subject]++;
          }
        }
      });

      const underTargetSubjects = Object.keys(lectureCounts).filter(subj => lectureCounts[subj] < 2);
      if (underTargetSubjects.length > 0) {
        lowLectureMembers.push({
          _id: user._id.toString(),
          name: user.name || 'Unknown',
          email: user.email,
          underTargetSubjects
        });
      }
    }

    res.json({
      success: true,
      message: lowLectureMembers.length > 0
        ? 'تم جلب الأعضاء الذين لديهم أقل من محاضرتين أسبوعيًا'
        : 'لا يوجد أعضاء لديهم أقل من محاضرتين أسبوعيًا',
      members: lowLectureMembers
    });
  } catch (error) {
    console.error('Error in low-lecture-members:', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Get lectures by user ID (Admin only)
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'يجب أن تكون أدمن لعرض محاضرات المستخدم' });
    }

    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'معرف المستخدم غير صالح' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.json({
      success: true,
      message: 'تم جلب المحاضرات بنجاح',
      lectures: user.lectures.map(lecture => ({
        _id: lecture._id.toString(),
        link: lecture.link,
        name: lecture.name,
        subject: lecture.subject,
        createdAt: lecture.createdAt.toISOString()
      }))
    });
  } catch (error) {
    console.error('خطأ في جلب محاضرات المستخدم:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;
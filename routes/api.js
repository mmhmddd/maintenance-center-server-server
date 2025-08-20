import express from 'express';
import { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sendEmail from '../utils/email.js';
import validator from 'validator';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Multer configuration for file uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    console.log('فحص نوع الملف:', file.mimetype, file.originalname);
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (extname && mimetype) {
      console.log('نوع الملف مقبول');
      return cb(null, true);
    } else {
      console.log('نوع الملف مرفوض');
      cb(new Error('يجب أن تكون الصورة بصيغة JPEG، PNG، GIF، أو WebP'));
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
});

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    console.error('لم يتم توفير رمز التوثيق');
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    console.log('تم التحقق من التوكن:', { userId: req.userId, role: req.userRole });
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error.message);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (req.userRole !== 'admin') {
    console.error('محاولة وصول غير مصرح بها:', req.userId);
    return res.status(403).json({ message: 'يجب أن تكون مسؤولاً للوصول إلى هذا الطريق' });
  }
  next();
};

// Submit a join request
router.post('/join-requests', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, number, academicSpecialization, address, subjects } = req.body;
    if (!name || !email || !number || !academicSpecialization || !address) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، الرقم، التخصص الجامعي، والعنوان مطلوبة' });
    }
    if (!validator.isEmail(email)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingRequest = await JoinRequest.findOne({ email: normalizedEmail }).session(session);
    if (existingRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const joinRequest = new JoinRequest({ 
      name, 
      email: normalizedEmail, 
      number, 
      academicSpecialization, 
      address, 
      subjects: subjects || [] 
    });
    await joinRequest.save({ session });
    console.log('تم إنشاء طلب الانضمام:', joinRequest._id);
    await session.commitTransaction();
    session.endSession();
    res.status(201).json({ message: 'تم تسجيل طلب الانضمام بنجاح', id: joinRequest._id });
  } catch (error) {
    console.error('خطأ في تقديم طلب الانضمام:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all join requests
router.get('/join-requests', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const joinRequests = await JoinRequest.find();
    console.log('تم جلب طلبات الانضمام:', joinRequests.length);
    res.json(joinRequests);
  } catch (error) {
    console.error('خطأ في جلب طلبات الانضمام:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.post('/join-requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // التحقق من وجود متغيرات البيئة لإعدادات البريد الإلكتروني
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'خطأ في إعدادات البريد الإلكتروني، تحقق من متغيرات البيئة' });
    }

    // البحث عن طلب الانضمام باستخدام المعرف
    const joinRequest = await JoinRequest.findById(req.params.id).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    // التحقق من أن الطلب في حالة "معلق"
    if (joinRequest.status !== 'Pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    // تحديث حالة الطلب إلى "موافق عليه" وتعيين ساعات التطوع إلى 0
    joinRequest.status = 'Approved';
    joinRequest.volunteerHours = 0;
    await joinRequest.save({ session });

    // التحقق من صحة البريد الإلكتروني
    if (!validator.isEmail(joinRequest.email)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني للطلب غير صالح' });
    }

    // التحقق من عدم وجود مستخدم مسجل مسبقًا بنفس البريد الإلكتروني
    const existingUser = await User.findOne({ email: joinRequest.email }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'حساب المستخدم موجود بالفعل' });
    }

    // إنشاء كلمة مرور عشوائية وتشفيرها
    const randomPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await hash(randomPassword, 10);

    // إنشاء مستخدم جديد
    const user = new User({
      email: joinRequest.email.toLowerCase().trim(),
      password: hashedPassword,
      numberOfStudents: 0,
      subjects: joinRequest.subjects || [],
      students: [],
      meetings: [],
      lectures: [],
      lectureCount: 0,
      role: 'user',
      profileImage: null,
      profileImagePublicId: null
    });
    await user.save({ session });
    console.log('تم إنشاء المستخدم:', user.email);

    // إرسال بريد إلكتروني للمستخدم مع بيانات الاعتماد
    try {
      await sendEmail({
        to: joinRequest.email,
        subject: 'تم الموافقة على طلب الانضمام الخاص بك',
        text: `مرحبًا ${joinRequest.name},\n\nتم الموافقة على طلب انضمامك!\nبريدك الإلكتروني: ${joinRequest.email}\nكلمة المرور: ${randomPassword}\n\nيرجى تسجيل الدخول وتغيير كلمة المرور لاحقًا.\n\nتحياتنا,\nفريق الإدارة`,
      });
      console.log('تم إرسال البريد الإلكتروني إلى:', joinRequest.email);
    } catch (emailError) {
      console.error('فشل إرسال البريد الإلكتروني:', emailError.message);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني', error: emailError.message });
    }

    // تأكيد المعاملة وإنهاء الجلسة
    await session.commitTransaction();
    session.endSession();
    res.json({
      message: 'تم الموافقة على الطلب وإنشاء الحساب وإرسال كلمة المرور عبر البريد الإلكتروني',
      email: user.email,
    });
  } catch (error) {
    console.error('خطأ في الموافقة على طلب الانضمام:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'فشل في الموافقة على الطلب', error: error.message });
  }
});
// Reject a join request
router.post('/join-requests/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const joinRequest = await JoinRequest.findById(req.params.id);
    if (!joinRequest) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Rejected';
    await joinRequest.save();
    console.log('تم رفض طلب الانضمام:', joinRequest._id);
    res.json({ message: 'تم رفض الطلب' });
  } catch (error) {
    console.error('خطأ في رفض طلب الانضمام:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete an approved member
router.delete('/members/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const memberId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'معرف العضو غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(memberId).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'العضو غير موجود' });
    }

    if (joinRequest.status !== 'Approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: joinRequest.email.toLowerCase().trim() }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    // Delete profile image from Cloudinary if exists
    if (user.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profileImagePublicId);
        console.log('تم حذف الصورة من Cloudinary:', user.profileImagePublicId);
      } catch (cloudinaryError) {
        console.error('خطأ في حذف الصورة من Cloudinary:', cloudinaryError.message);
      }
    }

    await JoinRequest.deleteOne({ _id: memberId }).session(session);
    await User.deleteOne({ email: joinRequest.email.toLowerCase().trim() }).session(session);

    await session.commitTransaction();
    session.endSession();
    console.log('تم حذف العضو:', { memberId, email: joinRequest.email });
    res.json({ message: 'تم حذف العضو بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف العضو:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all approved members with details
router.get('/approved-members', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const membersWithDetails = await Promise.all(approvedMembers.map(async (member) => {
      const user = await User.findOne({ email: member.email.toLowerCase().trim() });
      const lecturesWithStudentNames = user?.lectures.map(lecture => ({
        ...lecture.toObject(),
        studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
      })) || [];
      return {
        id: member._id,
        name: member.name,
        email: member.email,
        phone: member.number,
        address: member.address,
        academicSpecialization: member.academicSpecialization,
        volunteerHours: member.volunteerHours || 0,
        numberOfStudents: user?.numberOfStudents || 0,
        subjects: user?.subjects || [],
        students: user?.students || [],
        meetings: user?.meetings || [],
        lectures: lecturesWithStudentNames,
        lectureCount: user?.lectureCount || 0,
        profileImage: user?.profileImage || null
      };
    }));
    console.log('تم جلب الأعضاء المعتمدين:', membersWithDetails.length);
    res.json(membersWithDetails);
  } catch (error) {
    console.error('خطأ في جلب الأعضاء المعتمدين:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get member details by ID
router.get('/members/:id', authMiddleware, async (req, res) => {
  try {
    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    const user = await User.findOne({ email: member.email.toLowerCase().trim() });
    const lecturesWithStudentNames = user?.lectures.map(lecture => ({
      ...lecture.toObject(),
      studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
    })) || [];
    res.json({
      success: true, // إضافة حقل success لتتناسب مع JoinRequestResponse
      member: {
        id: member._id,
        name: member.name,
        email: member.email,
        phone: member.number,
        address: member.address,
        academicSpecialization: member.academicSpecialization,
        volunteerHours: member.volunteerHours || 0,
        numberOfStudents: user?.numberOfStudents || 0,
        subjects: user?.subjects || [],
        students: user?.students || [],
        lectures: lecturesWithStudentNames,
        lectureCount: user?.lectureCount || 0,
        status: member.status,
        createdAt: member.createdAt,
        profileImage: user?.profileImage || null,
        messages: user?.messages || []
      }
    });
  } catch (error) {
    console.error('خطأ في جلب تفاصيل العضو:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update member details
router.put('/members/:id/update-details', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { volunteerHours, numberOfStudents, students, subjects } = req.body;

    if (
      volunteerHours === undefined ||
      numberOfStudents === undefined ||
      !Array.isArray(students) ||
      !Array.isArray(subjects)
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'ساعات التطوع، عدد الطلاب، بيانات الطلاب، والمواد مطلوبة' });
    }

    if (volunteerHours < 0 || numberOfStudents < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'ساعات التطوع وعدد الطلاب يجب أن يكونا صفر أو أكثر' });
    }

    if (students.some(student => !student.name || !student.email || !student.phone)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'بيانات الطلاب يجب أن تحتوي على الاسم، البريد الإلكتروني، والهاتف' });
    }

    if (students.some(student => student.grade && !validator.isLength(student.grade, { min: 1, max: 50 }))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الصف يجب أن يكون بين 1 و50 حرفًا إذا تم توفيره' });
    }

    if (students.some(student => student.subjects && !Array.isArray(student.subjects))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'المواد يجب أن تكون مصفوفة' });
    }

    if (students.some(student => student.subjects && student.subjects.some(subject => !validator.isLength(subject.name, { min: 1, max: 100 })))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'كل مادة يجب أن تكون بين 1 و100 حرف إذا تم توفيرها' });
    }

    if (students.some(student => student.subjects && student.subjects.some(subject => subject.minLectures === undefined || subject.minLectures < 0))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الحد الأدنى للمحاضرات يجب أن يكون صفر أو أكثر' });
    }

    const member = await JoinRequest.findById(req.params.id).session(session);
    if (!member) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'العضو غير موجود' });
    }

    if (member.status !== 'Approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email.toLowerCase().trim() }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    // Fix invalid lectures by removing entries with missing or invalid studentEmail
    if (Array.isArray(user.lectures)) {
      const originalLectureCount = user.lectures.length;
      user.lectures = user.lectures.filter(lecture => lecture.studentEmail && validator.isEmail(lecture.studentEmail));
      const removedCount = originalLectureCount - user.lectures.length;
      if (removedCount > 0) {
        console.log('تمت إزالة محاضرات غير صالحة:', { userId: user._id, removedCount });
        user.lectureCount = Math.max(0, user.lectureCount - removedCount);
      }
    }

    member.volunteerHours = volunteerHours;
    member.students = students.map(student => ({
      ...student,
      email: student.email.toLowerCase().trim()
    }));
    member.subjects = subjects;

    user.numberOfStudents = numberOfStudents;
    user.students = students.map(student => ({
      ...student,
      email: student.email.toLowerCase().trim()
    }));
    user.subjects = subjects;

    await Promise.all([member.save({ session }), user.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('تم تحديث تفاصيل العضو:', { 
      memberId: member._id,
      volunteerHours, 
      numberOfStudents, 
      studentsCount: students.length, 
      subjects 
    });

    res.json({ 
      message: 'تم تحديث التفاصيل بنجاح',
      volunteerHours: member.volunteerHours,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects
    });
  } catch (error) {
    console.error('خطأ في تحديث تفاصيل العضو:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add a single student to a member
router.post('/members/:id/add-student', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, phone, grade, subjects } = req.body;
    if (!name || !email || !phone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، والهاتف مطلوبة للطالب' });
    }
    if (!validator.isEmail(email)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب غير صالح' });
    }
    if (grade && !validator.isLength(grade, { min: 1, max: 50 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الصف يجب أن يكون بين 1 و50 حرفًا إذا تم توفيره' });
    }
    if (subjects && !Array.isArray(subjects)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'المواد يجب أن تكون مصفوفة' });
    }
    if (subjects && subjects.some(subject => !validator.isLength(subject.name, { min: 1, max: 100 }))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'كل مادة يجب أن تكون بين 1 و100 حرف إذا تم توفيرها' });
    }
    if (subjects && subjects.some(subject => subject.minLectures === undefined || subject.minLectures < 0)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الحد الأدنى للمحاضرات يجب أن يكون صفر أو أكثر' });
    }

    const member = await JoinRequest.findById(req.params.id).session(session);
    if (!member) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    if (member.status !== 'Approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email.toLowerCase().trim() }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    // التحقق من الحد الأقصى لعدد الطلاب (مثال: 50)
    const MAX_STUDENTS = 50;
    if (user.students.length >= MAX_STUDENTS) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `لا يمكن إضافة المزيد من الطلاب، الحد الأقصى ${MAX_STUDENTS}` });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!Array.isArray(user.students)) user.students = [];
    if (!Array.isArray(member.students)) member.students = [];

    if (user.students.some(student => student.email.toLowerCase() === normalizedEmail)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب مستخدم بالفعل' });
    }

    // التحقق من أن المواد موجودة في قائمة المستخدم
    if (subjects && Array.isArray(subjects)) {
      const userSubjects = user.subjects.map(s => s.toLowerCase());
      const invalidSubjects = subjects.filter(subject => !userSubjects.includes(subject.name.toLowerCase()));
      if (invalidSubjects.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `المواد التالية غير موجودة في قائمة المستخدم: ${invalidSubjects.map(s => s.name).join(', ')}` });
      }
    }

    const newStudent = { 
      name, 
      email: normalizedEmail, 
      phone, 
      grade, 
      subjects: subjects ? subjects.map(subject => ({
        name: subject.name.toLowerCase().trim(),
        minLectures: subject.minLectures
      })) : [] 
    };
    user.students.push(newStudent);
    member.students.push(newStudent);
    user.numberOfStudents = (user.numberOfStudents || 0) + 1;

    if (!Array.isArray(user.subjects)) user.subjects = [];
    if (!Array.isArray(member.subjects)) member.subjects = [];

    if (subjects && Array.isArray(subjects)) {
      const subjectNames = subjects.map(subject => subject.name.toLowerCase().trim());
      user.subjects = [...new Set([...user.subjects, ...subjectNames])];
      member.subjects = [...new Set([...member.subjects, ...subjectNames])];
    }

    // تحديث ساعات التطوع
    member.volunteerHours = (member.volunteerHours || 0) + 1;

    await Promise.all([member.save({ session }), user.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('تم إضافة الطالب:', { 
      memberId: member._id, 
      studentEmail: normalizedEmail, 
      numberOfStudents: user.numberOfStudents 
    });

    res.json({
      message: 'تم إضافة الطالب بنجاح',
      student: newStudent,
      numberOfStudents: user.numberOfStudents,
      subjects: user.subjects
    });
  } catch (error) {
    console.error('خطأ في إضافة الطالب:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    console.log('Login request received:', req.body);
    const { email, password } = req.body;
    if (!email || !password) {
      console.log('Missing email or password');
      return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log('Normalized email:', normalizedEmail);
    if (!validator.isEmail(normalizedEmail)) {
      console.log('Invalid email format:', normalizedEmail);
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log('User not found for email:', normalizedEmail);
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch for user:', normalizedEmail);
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined');
      return res.status(500).json({ message: 'خطأ في إعدادات الخادم' });
    }

    const token = sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('Login successful, token generated for:', normalizedEmail);
    res.json({ token, userId: user._id, role: user.role });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      console.error('User not found for ID:', req.userId);
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() });

    const currentDate = new Date();
    user.messages = user.messages.filter(message => message.displayUntil > currentDate);
    await user.save();

    const lecturesWithStudentNames = user?.lectures.map(lecture => ({
      ...lecture.toObject(),
      studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
    })) || [];

    console.log('تم جلب الملف الشخصي:', {
      userId: req.userId,
      email: user.email,
      numberOfStudents: user.numberOfStudents
    });

    res.json({
      success: true,
      message: 'تم جلب الملف الشخصي بنجاح',
      data: {
        user: {
          id: user._id,
          email: user.email,
          profileImage: user.profileImage || null,
          numberOfStudents: user.numberOfStudents || 0,
          subjects: user.subjects || [],
          students: user.students || [],
          meetings: user.meetings || [],
          lectures: lecturesWithStudentNames,
          lectureCount: user.lectureCount || 0,
          messages: user.messages || []
        },
        joinRequest: joinRequest ? {
          name: joinRequest.name,
          phone: joinRequest.number,
          academicSpecialization: joinRequest.academicSpecialization,
          address: joinRequest.address,
          volunteerHours: joinRequest.volunteerHours || 0,
          status: joinRequest.status,
          students: joinRequest.students || [],
          subjects: joinRequest.subjects || [],
          lectures: lecturesWithStudentNames,
          lectureCount: user.lectureCount || 0
        } : null
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الملف الشخصي:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update password
router.put('/profile/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'كلمة المرور الحالية والجديدة مطلوبة' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const isMatch = await compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password = await hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (error) {
    console.error('خطأ في تحديث كلمة المرور:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Upload profile image to Cloudinary
router.post('/profile/image', authMiddleware, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      console.log('لم يتم تلقي أي ملف');
      return res.status(400).json({ success: false, message: 'يرجى اختيار صورة للرفع' });
    }

    console.log('تم تلقي الملف:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // Delete old image from Cloudinary if exists
    if (user.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profileImagePublicId);
        console.log('تم حذف الصورة القديمة من Cloudinary:', user.profileImagePublicId);
      } catch (deleteError) {
        console.error('خطأ في حذف الصورة القديمة من Cloudinary:', deleteError.message);
      }
    }

    // Upload new image to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'profile_images',
          resource_type: 'image',
          transformation: [
            { width: 500, height: 500, crop: 'limit' },
            { quality: 'auto' },
            { format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    user.profileImage = uploadResult.secure_url;
    user.profileImagePublicId = uploadResult.public_id;
    await user.save();

    console.log('تم تحديث بيانات المستخدم بالصورة الجديدة:', {
      profileImage: user.profileImage,
      profileImagePublicId: user.profileImagePublicId
    });

    res.json({
      success: true,
      message: 'تم رفع الصورة الشخصية بنجاح',
      data: { 
        profileImage: uploadResult.secure_url,
        fileName: req.file.originalname,
        fileSize: req.file.size
      }
    });
  } catch (error) {
    console.error('خطأ في رفع الصورة الشخصية:', error.message);
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء رفع الصورة', error: error.message });
  }
});

// Delete profile image
router.delete('/profile/image', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (!user.profileImagePublicId) {
      return res.status(400).json({ success: false, message: 'لا توجد صورة شخصية لحذفها' });
    }

    try {
      await cloudinary.uploader.destroy(user.profileImagePublicId);
      console.log('تم حذف الصورة من Cloudinary:', user.profileImagePublicId);
    } catch (cloudinaryError) {
      console.error('خطأ في حذف الصورة من Cloudinary:', cloudinaryError.message);
    }

    user.profileImage = null;
    user.profileImagePublicId = null;
    await user.save();

    res.json({ success: true, message: 'تم حذف الصورة الشخصية بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الصورة الشخصية:', error.message);
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء حذف الصورة', error: error.message });
  }
});

// Add a meeting to calendar
router.post('/profile/meetings', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (!Array.isArray(user.meetings)) user.meetings = [];

    user.meetings.push({ title, date: parsedDate, startTime, endTime, reminded: false });
    await user.save();
    console.log('تم إضافة الموعد:', user.meetings[user.meetings.length - 1]);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم إضافة الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في إضافة الموعد:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update a meeting
router.put('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    const meetingId = req.params.meetingId;

    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    meeting.title = title;
    meeting.date = parsedDate;
    meeting.startTime = startTime;
    meeting.endTime = endTime;
    meeting.reminded = false;

    await user.save();
    console.log('تم تحديث الموعد:', meetingId);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم تحديث الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في تحديث الموعد:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a meeting
router.delete('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      console.error('معرف الموعد غير صالح:', meetingId);
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.error('المستخدم غير موجود للمعرف:', req.userId);
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      console.error('الموعد غير موجود للمعرف:', meetingId);
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    user.meetings.pull(meetingId);
    await user.save();
    console.log('تم حذف الموعد:', meetingId);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم حذف الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في حذف الموعد:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpire = Date.now() + 3600000; // 1 hour expiration

    user.resetToken = resetToken;
    user.tokenExpire = tokenExpire;
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/reset-password/${resetToken}`;
    const message = `مرحبًا,\n\nلقد طلبت إعادة تعيين كلمة المرور. يرجى النقر على الرابط التالي لإعادة تعيين كلمة المرور الخاصة بك:\n${resetUrl}\n\nهذا الرابط صالح لمدة ساعة واحدة فقط.\n\nإذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد الإلكتروني.\n\nتحياتنا,\nفريق الإدارة`;

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: 'إعادة تعيين كلمة المرور',
        text: message,
      });
      console.log('تم إرسال بريد إلكتروني لإعادة تعيين كلمة المرور إلى:', normalizedEmail);
      res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' });
    } catch (emailError) {
      console.error('فشل إرسال بريد إلكتروني لإعادة تعيين كلمة المرور:', emailError.message);
      user.resetToken = null;
      user.tokenExpire = null;
      await user.save();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني', error: emailError.message });
    }
  } catch (error) {
    console.error('خطأ في طلب إعادة تعيين كلمة المرور:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Manually send meeting reminder
router.post('/profile/meetings/:meetingId/remind', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }
    await sendEmail({
      to: user.email,
      subject: 'تذكير يدوي بموعد اجتماع',
      text: `مرحبًا،\n\nهذا تذكير يدوي بموعدك "${meeting.title}" في ${meeting.date.toISOString().split('T')[0]} الساعة ${meeting.startTime}.\n\nتحياتنا,\nفريق قطرة غيث`,
    });
    console.log(`تم إرسال تذكير يدوي إلى ${user.email} للموعد ${meeting._id}`);
    meeting.reminded = true;
    await user.save();
    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));
    res.json({ message: 'تم إرسال التذكير اليدوي بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في إرسال التذكير اليدوي:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});


// Send a message
router.post('/admin/send-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, content, displayDays } = req.body;
    if (!userId || !content || !displayDays) {
      return res.status(400).json({ message: 'معرف المستخدم، الرسالة، وعدد الأيام للعرض مطلوبة' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'معرف المستخدم غير صالح' });
    }
    if (!validator.isLength(content, { min: 1, max: 1000 })) {
      return res.status(400).json({ message: 'الرسالة يجب أن تكون بين 1 و1000 حرف' });
    }
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 30) {
      return res.status(400).json({ message: 'عدد الأيام يجب أن يكون عددًا صحيحًا بين 1 و30' });
    }

    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const now = new Date();
    if (targetUser.messages && targetUser.messages.length > 0) {
      const activeMessage = targetUser.messages.find(
        (msg) => new Date(msg.displayUntil) > now
      );
      if (activeMessage) {
        return res.status(400).json({
          message: 'يوجد رسالة نشطة بالفعل، يرجى تعديلها أو حذفها أولاً',
          activeMessage: {
            _id: activeMessage._id,
            content: activeMessage.content,
            displayUntil: activeMessage.displayUntil,
          },
        });
      }
    }

    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);

    const newMessage = {
      _id: new mongoose.Types.ObjectId(),
      content,
      displayUntil,
      createdAt: new Date(),
    };

    targetUser.messages = [newMessage];
    await targetUser.save();

    console.log('تم إرسال الرسالة:', {
      userId,
      messageId: newMessage._id,
      email: joinRequest.email,
      content,
      displayUntil,
    });

    res.json({
      success: true,
      message: 'تم إرسال الرسالة بنجاح',
      data: {
        _id: newMessage._id,
        content: newMessage.content,
        displayUntil: newMessage.displayUntil,
      },
    });
  } catch (error) {
    console.error('خطأ في إرسال الرسالة:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Edit a message
router.put('/admin/edit-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId, content, displayDays } = req.body;
    if (!userId || !messageId || !content || !displayDays) {
      return res.status(400).json({ message: 'معرف المستخدم، معرف الرسالة، الرسالة، وعدد الأيام للعرض مطلوبة' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'معرف المستخدم أو معرف الرسالة غير صالح' });
    }
    if (!validator.isLength(content, { min: 1, max: 1000 })) {
      return res.status(400).json({ message: 'الرسالة يجب أن تكون بين 1 و1000 حرف' });
    }
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 30) {
      return res.status(400).json({ message: 'عدد الأيام يجب أن يكون عددًا صحيحًا بين 1 و30' });
    }

    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const message = targetUser.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);
    message.content = content;
    message.displayUntil = displayUntil;

    await targetUser.save();

    console.log('تم تعديل الرسالة:', { userId, messageId, email: joinRequest.email, content, displayUntil });

    res.json({ message: 'تم تعديل الرسالة بنجاح', displayUntil });
  } catch (error) {
    console.error('خطأ في تعديل الرسالة:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a message
router.delete('/admin/delete-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId } = req.body;
    if (!userId || !messageId) {
      return res.status(400).json({ message: 'معرف المستخدم ومعرف الرسالة مطلوبان' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'معرف المستخدم أو معرف الرسالة غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const message = targetUser.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    targetUser.messages.pull(messageId);
    await targetUser.save();

    console.log('تم حذف الرسالة:', { userId, messageId, email: joinRequest.email });

    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الرسالة:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get a message by ID
router.get('/admin/get-message/:userId/:messageId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId } = req.params;
    if (!userId || !messageId) {
      return res.status(400).json({ message: 'معرف المستخدم ومعرف الرسالة مطلوبان' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'معرف المستخدم أو معرف الرسالة غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const message = targetUser.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    const now = new Date();
    if (new Date(message.displayUntil) < now) {
      return res.status(410).json({ message: 'الرسالة منتهية الصلاحية' });
    }

    console.log('تم جلب الرسالة:', { userId, messageId, email: joinRequest.email, content: message.content, displayUntil: message.displayUntil });

    res.json({
      success: true,
      message: {
        _id: message._id,
        content: message.content,
        displayUntil: message.displayUntil,
      },
    });
  } catch (error) {
    console.error('خطأ في جلب الرسالة:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get members with low lecture counts
router.get('/low-lecture-members', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const lowLectureMembers = [];

    for (const member of approvedMembers) {
      const user = await User.findOne({ email: member.email.toLowerCase().trim() });
      if (!user) continue;

      const lowLectureStudents = [];
      for (const student of user.students) {
        const lowLectureSubjects = [];
        for (const subject of student.subjects) {
          const lectureCount = user.lectures.filter(
            lecture => lecture.studentEmail.toLowerCase() === student.email.toLowerCase() &&
                      lecture.subject.toLowerCase() === subject.name.toLowerCase()
          ).length;
          if (lectureCount < subject.minLectures) {
            lowLectureSubjects.push({
              name: subject.name,
              currentLectures: lectureCount,
              minLectures: subject.minLectures
            });
          }
        }
        if (lowLectureSubjects.length > 0) {
          lowLectureStudents.push({
            studentEmail: student.email,
            studentName: student.name,
            subjects: lowLectureSubjects
          });
        }
      }

      if (lowLectureStudents.length > 0) {
        lowLectureMembers.push({
          id: member._id,
          name: member.name,
          email: member.email,
          lowLectureStudents
        });
      }
    }

    console.log('تم جلب الأعضاء ذوي المحاضرات المنخفضة:', lowLectureMembers.length);
    res.json(lowLectureMembers);
  } catch (error) {
    console.error('خطأ في جلب الأعضاء ذوي المحاضرات المنخفضة:', error.message);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;
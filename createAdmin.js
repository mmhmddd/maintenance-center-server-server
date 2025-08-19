import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { hash } from 'bcryptjs';
import User from './models/User.js'; // تأكد من أن المسار صحيح بناءً على هيكل مشروعك

// Load environment variables
dotenv.config();

// Connect to the database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('تم الاتصال بقاعدة البيانات بنجاح');
  } catch (error) {
    console.error('خطأ في الاتصال بقاعدة البيانات:', error);
    process.exit(1);
  }
};

// Function to create an admin user
const createAdminUser = async (email, password) => {
  try {
    // التحقق إذا كان المستخدم موجودًا بالفعل
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      console.log(`المستخدم ${email} موجود بالفعل!`);
      return;
    }

    // تشفير كلمة المرور
    const hashedPassword = await hash(password, 10);

    // إنشاء المستخدم الجديد كإداري
    const newUser = new User({
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'admin', // جعله إداريًا مباشرة
      numberOfStudents: 0,
      subjects: [],
      students: [],
      meetings: [],
      lectures: [],
      lectureCount: 0,
      profileImage: null,
      profileImagePublicId: null,
      messages: [] // إضافة الحقول الافتراضية بناءً على نموذج User من الكود الخاص بك
    });

    await newUser.save();
    console.log(`تم إنشاء المستخدم الإداري ${email} بنجاح! كلمة المرور: ${password} (غيرها بعد تسجيل الدخول)`);
  } catch (error) {
    console.error('خطأ في إنشاء المستخدم:', error);
  } finally {
    // إغلاق الاتصال
    await mongoose.connection.close();
    console.log('تم إغلاق الاتصال بقاعدة البيانات');
  }
};

// Execute the script
const run = async () => {
  await connectDB();
  await createAdminUser('medo27383298@gmail.com', '111111'); // غير البريد وكلمة المرور حسب الحاجة
};

run();
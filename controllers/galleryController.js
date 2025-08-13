import Gallery from '../models/Gallery.js';
import User from '../models/User.js';
import cloudinary from 'cloudinary';

// Add a new image to the gallery
export const addImage = async (req, res) => {
  try {
    const { title, description } = req.body;
    const image = req.file;

    if (!title || !image) {
      return res.status(400).json({ message: 'العنوان والصورة مطلوبان' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.v2.uploader.upload(`data:${image.mimetype};base64,${image.buffer.toString('base64')}`, {
      folder: 'gallery'
    });

    const galleryImage = new Gallery({
      title,
      description,
      imagePath: result.secure_url,
      imagePublicId: result.public_id,
      uploadedBy: req.userId
    });

    await galleryImage.save();
    console.log('تم إضافة صورة إلى المعرض:', { title, imagePath: result.secure_url });

    res.status(201).json({
      message: 'تم إضافة الصورة بنجاح',
      data: {
        id: galleryImage._id,
        title: galleryImage.title,
        description: galleryImage.description,
        imagePath: galleryImage.imagePath,
        uploadedBy: galleryImage.uploadedBy,
        createdAt: galleryImage.createdAt
      }
    });
  } catch (error) {
    console.error('خطأ في إضافة الصورة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Edit an existing image in the gallery
export const editImage = async (req, res) => {
  try {
    const { title, description } = req.body;
    const image = req.file;
    const imageId = req.params.id;

    const galleryImage = await Gallery.findById(imageId);
    if (!galleryImage) {
      return res.status(404).json({ message: 'الصورة غير موجودة' });
    }

    if (galleryImage.uploadedBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل هذه الصورة' });
    }

    if (title) galleryImage.title = title;
    if (description !== undefined) galleryImage.description = description;

    if (image) {
      // Delete old image from Cloudinary
      if (galleryImage.imagePublicId) {
        await cloudinary.v2.uploader.destroy(galleryImage.imagePublicId);
      }
      // Upload new image
      const result = await cloudinary.v2.uploader.upload(`data:${image.mimetype};base64,${image.buffer.toString('base64')}`, {
        folder: 'gallery'
      });
      galleryImage.imagePath = result.secure_url;
      galleryImage.imagePublicId = result.public_id;
    }

    await galleryImage.save();
    console.log('تم تحديث الصورة:', { id: imageId, title: galleryImage.title });

    res.json({
      message: 'تم تحديث الصورة بنجاح',
      data: {
        id: galleryImage._id,
        title: galleryImage.title,
        description: galleryImage.description,
        imagePath: galleryImage.imagePath,
        uploadedBy: galleryImage.uploadedBy,
        createdAt: galleryImage.createdAt
      }
    });
  } catch (error) {
    console.error('خطأ في تحديث الصورة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Delete an image from the gallery
export const deleteImage = async (req, res) => {
  try {
    const imageId = req.params.id;
    const galleryImage = await Gallery.findById(imageId);

    if (!galleryImage) {
      return res.status(404).json({ message: 'الصورة غير موجودة' });
    }

    if (galleryImage.uploadedBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ message: 'غير مصرح لك بحذف هذه الصورة' });
    }

    // Delete image from Cloudinary
    if (galleryImage.imagePublicId) {
      await cloudinary.v2.uploader.destroy(galleryImage.imagePublicId).catch(() => {});
    }

    await Gallery.deleteOne({ _id: imageId });
    console.log('تم حذف الصورة:', { id: imageId });

    res.json({ message: 'تم حذف الصورة بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الصورة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Get all images in the gallery
export const getAllImages = async (req, res) => {
  try {
    const galleryImages = await Gallery.find().populate('uploadedBy', 'email');
    if (!galleryImages.length) {
      return res.status(404).json({ message: 'لا توجد صور في المعرض' });
    }

    const formattedImages = galleryImages.map(image => {
      // تسجيل تصحيح مؤقت لتتبع المشكلة
      console.log('Image ID:', image._id, 'UploadedBy:', image.uploadedBy);
      return {
        id: image._id,
        title: image.title,
        description: image.description,
        imagePath: image.imagePath,
        uploadedBy: image.uploadedBy?.email || 'غير متوفر', // إصلاح الخطأ هنا
        createdAt: image.createdAt
      };
    });

    console.log('تم جلب جميع الصور:', formattedImages.length);
    res.json({
      message: 'تم جلب جميع الصور بنجاح',
      data: formattedImages
    });
  } catch (error) {
    console.error('خطأ في جلب جميع الصور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Get a single image by ID
export const getImageById = async (req, res) => {
  try {
    const imageId = req.params.id;
    const galleryImage = await Gallery.findById(imageId).populate('uploadedBy', 'email');

    if (!galleryImage) {
      return res.status(404).json({ message: 'الصورة غير موجودة' });
    }

    // تسجيل تصحيح مؤقت لتتبع المشكلة
    console.log('Image ID:', imageId, 'UploadedBy:', galleryImage.uploadedBy);

    console.log('تم جلب الصورة:', { id: imageId });
    res.json({
      message: 'تم جلب الصورة بنجاح',
      data: {
        id: galleryImage._id,
        title: galleryImage.title,
        description: galleryImage.description,
        imagePath: galleryImage.imagePath,
        uploadedBy: galleryImage.uploadedBy?.email || 'غير متوفر', // إصلاح الخطأ هنا
        createdAt: galleryImage.createdAt
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الصورة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};
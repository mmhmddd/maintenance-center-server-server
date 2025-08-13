export default function adminMiddleware(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ message: 'ممنوع: يتطلب صلاحيات إدارية' });
  }
  next();
}
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const profilePicUpload = (req, res, next) => {
    const uploadSingle = upload.single('profilePic');
    uploadSingle(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Pic is too large' });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message || 'Something went wrong during upload' });
        }
        next();
    });
};

router.post('/first-admin', authController.createFirstAdmin);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/me', authMiddleware, authController.getMe);
router.get('/my-team', authMiddleware, authController.getMyTeam);
router.get('/team/:leaderId', authMiddleware, authController.getSpecificTeam);
router.get('/users/:id', authMiddleware, authController.getUserById);
router.put('/profile', authMiddleware, profilePicUpload, authController.updateProfile);
router.put('/users/:id/role', authMiddleware, authController.updateUserRole);
router.put('/users/:id/team-leader', authMiddleware, authController.assignTeamLeader);
router.delete('/users/:id', authMiddleware, authController.deleteUserGlobally);

module.exports = router;

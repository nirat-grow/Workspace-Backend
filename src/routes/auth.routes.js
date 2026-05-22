const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'src/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

router.post('/first-admin', authController.createFirstAdmin);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/me', authMiddleware, authController.getMe);
router.get('/my-team', authMiddleware, authController.getMyTeam);
router.get('/team/:leaderId', authMiddleware, authController.getSpecificTeam);
router.get('/users/:id', authMiddleware, authController.getUserById);
router.put('/profile', authMiddleware, upload.single('profilePic'), authController.updateProfile);
router.put('/users/:id/role', authMiddleware, authController.updateUserRole);
router.put('/users/:id/team-leader', authMiddleware, authController.assignTeamLeader);
router.delete('/users/:id', authMiddleware, authController.deleteUserGlobally);

module.exports = router;

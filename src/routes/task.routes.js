const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const commentController = require('../controllers/comment.controller');
const timelogController = require('../controllers/timelog.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/permission.middleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'src/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Telegram direct action route (unprotected)
router.get('/stop-timer/:id', taskController.stopTimerFromTelegram);

router.use(authMiddleware);

router.get('/', taskController.getTasks);
router.get('/my-assigned', taskController.getMyAssignedTasks);
router.post('/', checkPermission('canCreateTask'), taskController.createTask);
router.get('/:id', taskController.getTask);
router.put('/:id', checkPermission('canEditTask'), taskController.updateTask);
router.delete('/:id', checkPermission('canDeleteTask'), taskController.deleteTask);
router.put('/:id/status', taskController.updateTaskStatus);
router.put('/:id/assign', checkPermission('canAssignTask'), taskController.assignTask);

// Comments & Timelogs specific to tasks
router.post('/:id/comments', commentController.addComment);
router.post('/:id/timelog', timelogController.addTimeLog);
router.get('/:id/timelog', timelogController.getTaskTimeLogs);
router.post('/:id/attachments', upload.array('files', 10), taskController.uploadAttachment);
router.delete('/:id/attachments/:attachmentId', taskController.deleteAttachment);

module.exports = router;

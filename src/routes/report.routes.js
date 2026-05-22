const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/daily', reportController.getDaily);
router.get('/weekly', reportController.getWeekly);
router.get('/monthly', reportController.getMonthly);
router.get('/overdue', reportController.getOverdue);
router.get('/hours', reportController.getHours);
router.get('/delegated', reportController.getDelegated);
router.post('/telegram', reportController.triggerTelegram);
router.get('/timesheets', reportController.getTimesheets);
router.get('/project-team', reportController.getProjectReport);
router.get('/global', reportController.getGlobalReport);
router.get('/history', reportController.getHistory);

module.exports = router;

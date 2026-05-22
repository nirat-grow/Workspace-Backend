const express = require('express');
const router = express.Router();
const timelogController = require('../controllers/timelog.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

// Global timelog routes can go here, e.g. if any are not mounted under task
// Wait, the index.js mounts /api/timelog here. 
// However, the task-specific ones are in task.routes.js.
// We can just export an empty router or keep it for future global timelog routes.

module.exports = router;

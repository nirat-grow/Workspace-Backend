const express = require('express');
const router = express.Router();
const commentController = require('../controllers/comment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

// These will be accessed via /api/comments/:id
router.delete('/:id', commentController.deleteComment);

// Mount task-specific comment routes in task.routes or here by passing full path
// Actually we will mount them in task.routes.js, but let's just expose the controllers here
// Wait, the index.js mounts /api/comments. 
// So for POST /api/tasks/:id/comments we will just put it in task.routes.js

module.exports = router;

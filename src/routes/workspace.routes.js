const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspace.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/permission.middleware');

router.use(authMiddleware);

router.post('/', workspaceController.createWorkspace); // ADMIN
router.get('/:id', workspaceController.getWorkspace);
router.post('/:id/members', workspaceController.addMember);

module.exports = router;

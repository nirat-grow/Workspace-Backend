const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.post('/', projectController.createProject);
router.get('/:id', projectController.getProject);
router.post('/:id/members', projectController.addMembers);
router.post('/:id/members/bulk', projectController.addMembers);
router.put('/:id/members/:userId', projectController.updateMember);
router.delete('/:id/members/:userId', projectController.removeMember);
router.delete('/:id', projectController.deleteProject);

module.exports = router;
